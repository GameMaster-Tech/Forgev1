/**
 * POST /api/echo/scan
 *
 * Run Echo — the proactive tension detector.
 *
 *   1. Throttle: refuse if the last scan was < THROTTLE_MS ago
 *      (default 10 min). Override with { force: true } in body.
 *   2. Gather every signal Echo needs in one admin-SDK pass.
 *   3. Single Groq call over the structured corpus → JSON of
 *      notices, capped at MAX_NOTICES.
 *   4. For each notice: compute signalHash → upsert to Firestore
 *      at `users/{uid}/echo_notices/{signalHash}` IFF a matching
 *      hash doesn't already exist as a dismissed / snoozed record
 *      (those are kept so we never re-bug the user about something
 *      they explicitly cleared).
 *   5. Stamp the user's lastScannedAt + summary stats so the
 *      throttle gate works on the next call.
 *
 * Response: EchoScanSummary.
 *
 * Server-only — Node runtime for the admin SDK + longer execution
 * envelope (typical scan is 2–6s end-to-end).
 */

import { NextResponse } from "next/server";
import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";
import { DEFAULT_MODEL, groqChat, GroqApiError } from "@/lib/ai/groq";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { formatCorpus, gatherEchoCorpus } from "@/lib/echo/gather";
import { signalHash } from "@/lib/echo/hash";
import type { EchoAction, EchoKind, EchoNotice, EchoSeverity, EchoSourceRef } from "@/lib/echo/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const THROTTLE_MS = 10 * 60_000; // 10 min between auto-scans
const MAX_NOTICES = 8;
const MAX_TOTAL_CORPUS_CHARS = 40_000;

const KINDS: EchoKind[] = [
  "doc_contradiction",
  "doc_freshness",
  "goal_drift",
  "calendar_misalignment",
  "capacity_overload",
  "missing_followthrough",
  "other",
];
const KIND_SET = new Set<string>(KINDS);
const SEVERITY_SET = new Set<string>(["low", "medium", "high"]);
const SOURCE_KINDS = new Set<string>(["doc", "event", "task", "goal"]);

const SYSTEM_PROMPT = `You are Echo, the proactive tension-detection layer inside Forge — an AI reactive workspace.

Your job is to read the user's workspace snapshot (projects, goals, open tasks, calendar events, documents) and surface the 3–8 most pressing TENSIONS — places where parts of the workspace disagree, drift, or fail to follow through. You ONLY speak when there's a genuinely useful observation. False positives erode trust.

Tension categories you may report (use the exact kind string):
  • "doc_contradiction"        Two documents make claims that can't both be true.
  • "doc_freshness"            A doc contains a time-sensitive claim that's likely stale today.
  • "goal_drift"               A goal hasn't been touched in 21+ days OR has zero supporting tasks.
  • "calendar_misalignment"    A stated plan in prose disagrees with what's on the calendar (e.g. "ship May 12" but no time blocked on it).
  • "capacity_overload"        The week has too many concurrent commitments (>30h scheduled, or >3 deep-work blocks per day).
  • "missing_followthrough"    A specific written commitment ("we'll invite 50 testers", "I'll publish by Friday") with no matching task / event / artifact.
  • "other"                    A high-signal tension that doesn't fit above.

For each notice you produce, return:
{
  "kind":     <one of the categories above>,
  "severity": "low" | "medium" | "high",
  "title":    "<one-line headline, ≤ 12 words>",
  "body":     "<1–2 sentences explaining what's tense and what the user can do about it>",
  "sourceRefs": [
    { "kind": "doc" | "event" | "task" | "goal", "id": "<the id from the corpus>", "label": "<short label>" }
  ],
  "actions": [
    { "kind": "jump_doc" | "jump_event" | "snooze" | "dismiss" | "mark_done", "label": "<button text>", "payload": { ...optional } }
  ]
}

Discipline:
  • Use ids verbatim from the corpus. Never invent ids.
  • severity=high only when the user will lose time / money / credibility if they don't see this today.
  • severity=medium for "should look at this week".
  • severity=low for housekeeping.
  • body addresses the user directly in second person ("You wrote…", "Your hiring memo says…").
  • body must NOT exceed 240 characters.
  • Always include a "dismiss" action AND a "snooze" action with payload { "hours": 24 }.
  • Include "jump_doc" with payload { "docId": "<id>" } when the source is a doc.
  • Include "jump_event" with payload { "eventId": "<id>" } when the source is an event.
  • NEVER report the same tension twice with different framing. Pick one.
  • Return MAX 8 notices. Pick the most clear-cut.
  • If everything is fine, return an empty array. Honesty beats noise.

Output STRICT JSON only — no markdown fences, no prose before or after:
{
  "notices": [ … ]
}`;

interface RawAction {
  kind?: unknown;
  label?: unknown;
  payload?: unknown;
}
interface RawSourceRef {
  kind?: unknown;
  id?: unknown;
  label?: unknown;
  projectId?: unknown;
}
interface RawNotice {
  kind?: unknown;
  severity?: unknown;
  title?: unknown;
  body?: unknown;
  sourceRefs?: unknown;
  actions?: unknown;
  projectId?: unknown;
}
interface RawPayload {
  notices?: unknown;
}

interface RequestBody {
  force?: unknown;
}

interface EchoMetaDoc {
  lastScannedAt?: number;
  noticesCreatedTotal?: number;
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    req,
    { routeId: "echo.scan", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(req, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  let body: RequestBody = {};
  try {
    body = (await req.json().catch(() => ({}))) as RequestBody;
  } catch {
    /* keep defaults */
  }
  const force = body.force === true;

  const fs = getAdminFirestore();
  const metaRef = fs.doc(`users/${auth.uid}/echo_meta/state`);

  // 1. Throttle.
  if (!force) {
    try {
      const metaSnap = await metaRef.get();
      if (metaSnap.exists) {
        const meta = metaSnap.data() as EchoMetaDoc;
        if (meta.lastScannedAt && Date.now() - meta.lastScannedAt < THROTTLE_MS) {
          return NextResponse.json({
            scannedAt: meta.lastScannedAt,
            newNoticesCreated: 0,
            activeNoticesAfter: await countActive(auth.uid),
            groqDurationMs: 0,
            throttled: true,
          });
        }
      }
    } catch {
      /* meta doc unreadable — go ahead and scan */
    }
  }

  // 2. Gather corpus.
  console.log(`[echo.scan] ← uid=${auth.uid} force=${force}`);
  let corpus;
  try {
    corpus = await gatherEchoCorpus(auth.uid);
  } catch (err) {
    console.error("[echo.scan] gather failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: "Couldn't read workspace state." },
      { status: 500 },
    );
  }

  const promptBody = formatCorpus(corpus).slice(0, MAX_TOTAL_CORPUS_CHARS);
  console.log(
    `[echo.scan] corpus: projects=${corpus.projects.length} docs=${corpus.docs.length} events=${corpus.events.length} tasks=${corpus.tasks.length} goals=${corpus.goals.length} chars=${promptBody.length}`,
  );

  // Nothing to scan? Skip Groq, write meta.
  if (
    corpus.projects.length === 0 &&
    corpus.docs.length === 0 &&
    corpus.events.length === 0 &&
    corpus.tasks.length === 0 &&
    corpus.goals.length === 0
  ) {
    await metaRef.set(
      { lastScannedAt: Date.now() },
      { merge: true },
    );
    return NextResponse.json({
      scannedAt: Date.now(),
      newNoticesCreated: 0,
      activeNoticesAfter: 0,
      groqDurationMs: 0,
    });
  }

  // 3. Groq.
  let groqResult;
  try {
    groqResult = await groqChat({
      model: DEFAULT_MODEL,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: promptBody }],
      maxCompletionTokens: 2_000,
      temperature: 0.15,
      jsonResponse: true,
      timeoutMs: 30_000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    const status = err instanceof GroqApiError ? err.status : 0;
    console.error(`[echo.scan] ✗ Groq failed (${status}) — ${message}`);
    await metaRef.set({ lastScannedAt: Date.now() }, { merge: true });
    return NextResponse.json(
      {
        scannedAt: Date.now(),
        newNoticesCreated: 0,
        activeNoticesAfter: await countActive(auth.uid),
        groqDurationMs: 0,
        error: `Upstream: ${message}`,
      },
      { status: 502 },
    );
  }

  // 4. Parse + validate + write.
  const rawNotices = parsePayload(groqResult.content);
  console.log(
    `[echo.scan] groq returned ${rawNotices.length} notice candidate${rawNotices.length === 1 ? "" : "s"} in ${groqResult.durationMs}ms (${groqResult.tokenUsage.total} tokens)`,
  );

  const docIds = new Set(corpus.docs.map((d) => d.id));
  const eventIds = new Set(corpus.events.map((e) => e.id));
  const taskIds = new Set(corpus.tasks.map((t) => t.id));
  const goalIds = new Set(corpus.goals.map((g) => g.id));

  const candidates: EchoNotice[] = [];
  for (const raw of rawNotices.slice(0, MAX_NOTICES)) {
    const candidate = normalizeNotice(raw, {
      uid: auth.uid,
      docIds,
      eventIds,
      taskIds,
      goalIds,
    });
    if (candidate) candidates.push(candidate);
  }

  console.log(
    `[echo.scan] validated ${candidates.length}/${rawNotices.length} candidates`,
  );

  // Write — skip any signalHash that already exists at the user's
  // notices collection (active OR dismissed) so we don't re-bug
  // the user about something they explicitly cleared.
  let created = 0;
  const batch = fs.batch();
  for (const candidate of candidates) {
    const ref = fs.doc(`users/${auth.uid}/echo_notices/${candidate.id}`);
    const existing = await ref.get();
    if (existing.exists) continue;
    batch.set(ref, {
      ...candidate,
      // FieldValue.serverTimestamp lives outside the type but Firestore
      // accepts it via admin SDK. We keep `createdAt` as millis for
      // ordering and stamp `createdAtServer` for audit.
      createdAtServer: FieldValue.serverTimestamp(),
    });
    created += 1;
  }
  if (created > 0) await batch.commit();

  const active = await countActive(auth.uid);

  // 5. Stamp meta.
  await metaRef.set(
    {
      lastScannedAt: Date.now(),
      noticesCreatedTotal: FieldValue.increment(created),
    },
    { merge: true },
  );

  console.log(
    `[echo.scan] ✓ created=${created} active=${active} groqMs=${groqResult.durationMs}`,
  );

  return NextResponse.json({
    scannedAt: Date.now(),
    newNoticesCreated: created,
    activeNoticesAfter: active,
    groqDurationMs: groqResult.durationMs,
  });
}

/* ─────────────────────────── helpers ─────────────────────────── */

async function countActive(uid: string): Promise<number> {
  const fs = getAdminFirestore();
  const snap = await fs
    .collection(`users/${uid}/echo_notices`)
    .where("dismissedAt", "==", null)
    .limit(50)
    .get()
    .catch(() => null);
  return snap?.size ?? 0;
}

function parsePayload(raw: string): RawNotice[] {
  if (!raw) return [];
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let parsed: RawPayload;
  try {
    parsed = JSON.parse(cleaned) as RawPayload;
  } catch {
    console.warn("[echo.scan] JSON parse failed:", cleaned.slice(0, 200));
    return [];
  }
  return Array.isArray(parsed.notices) ? (parsed.notices as RawNotice[]) : [];
}

function normalizeNotice(
  raw: RawNotice,
  guards: {
    uid: string;
    docIds: Set<string>;
    eventIds: Set<string>;
    taskIds: Set<string>;
    goalIds: Set<string>;
  },
): EchoNotice | null {
  const kind =
    typeof raw.kind === "string" && KIND_SET.has(raw.kind)
      ? (raw.kind as EchoKind)
      : null;
  if (!kind) return null;
  const severity =
    typeof raw.severity === "string" && SEVERITY_SET.has(raw.severity)
      ? (raw.severity as EchoSeverity)
      : "medium";
  const title = typeof raw.title === "string" ? raw.title.trim().slice(0, 140) : "";
  const body = typeof raw.body === "string" ? raw.body.trim().slice(0, 280) : "";
  if (!title || !body) return null;

  // Source refs — drop hallucinated ids.
  const rawRefs = Array.isArray(raw.sourceRefs) ? (raw.sourceRefs as RawSourceRef[]) : [];
  const sourceRefs: EchoSourceRef[] = [];
  for (const r of rawRefs.slice(0, 6)) {
    const k = typeof r.kind === "string" ? r.kind : "";
    const id = typeof r.id === "string" ? r.id : "";
    if (!SOURCE_KINDS.has(k) || !id) continue;
    if (k === "doc" && !guards.docIds.has(id)) continue;
    if (k === "event" && !guards.eventIds.has(id)) continue;
    if (k === "task" && !guards.taskIds.has(id)) continue;
    if (k === "goal" && !guards.goalIds.has(id)) continue;
    sourceRefs.push({
      kind: k as EchoSourceRef["kind"],
      id,
      label: typeof r.label === "string" ? r.label.slice(0, 80) : undefined,
      projectId: typeof r.projectId === "string" ? r.projectId : undefined,
    });
  }

  // Actions — always include dismiss + snooze if the model forgot.
  const rawActions = Array.isArray(raw.actions) ? (raw.actions as RawAction[]) : [];
  const actions: EchoAction[] = [];
  for (const a of rawActions.slice(0, 4)) {
    const k = typeof a.kind === "string" ? a.kind : "";
    if (!["jump_doc", "jump_event", "snooze", "dismiss", "mark_done"].includes(k)) continue;
    actions.push({
      kind: k as EchoAction["kind"],
      label: typeof a.label === "string" ? a.label.slice(0, 40) : "",
      payload:
        a.payload && typeof a.payload === "object"
          ? (a.payload as Record<string, unknown>)
          : undefined,
    });
  }
  // Defaults.
  if (!actions.some((a) => a.kind === "snooze")) {
    actions.push({ kind: "snooze", label: "Snooze 24h", payload: { hours: 24 } });
  }
  if (!actions.some((a) => a.kind === "dismiss")) {
    actions.push({ kind: "dismiss", label: "Dismiss" });
  }

  const projectId = typeof raw.projectId === "string" ? raw.projectId : null;

  const hash = signalHash({ kind, sourceRefs, title });

  return {
    id: hash,
    userId: guards.uid,
    projectId,
    kind,
    severity,
    title,
    body,
    sourceRefs,
    actions,
    signalHash: hash,
    createdAt: Date.now(),
    seen: false,
    snoozedUntil: null,
    dismissedAt: null,
    resolvedAs: null,
  };
}
