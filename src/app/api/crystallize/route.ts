/**
 * POST /api/crystallize
 *
 * Cross-doc synthesis. Forge's signature "no one else does this"
 * feature: the user picks 2–5 docs from a project, this route reads
 * them server-side, and returns a single one-page brief that
 * extracts:
 *
 *   • thesis           — the underlying claim the docs converge on
 *   • support          — the strongest evidence + which doc said it
 *   • counters         — the strongest counter-argument
 *   • open questions   — what's NOT in any doc but should be
 *   • whatToWriteNext  — the single doc you should write next
 *
 * The output is NOT a summary. It's a fresh synthesis — a memo
 * Forge writes back to you based on what your docs collectively
 * argue. Every claim cites the doc id it came from so the editor
 * can render jump-links.
 *
 * Body:
 *   { projectId: string, docIds: string[] }   // 2–5 docIds
 *
 * Response:
 *   {
 *     title:    string,                       // suggested title
 *     thesis:   string,
 *     support:  Array<{ docId, span, why }>,
 *     counters: Array<{ docId, span, why }>,
 *     openQuestions: string[],
 *     whatToWriteNext: string,
 *     bodyHtml: string,                       // ready to drop into TipTap
 *     groq:     { model, durationMs, tokens }
 *   }
 *
 * Security pipeline: requireUser → rate-limit → daily AI quota →
 * monthly budget peek → admin-SDK doc fetch (filtered by uid +
 * projectId) → Groq → JSON parse + hallucination guards.
 */

import { NextResponse } from "next/server";
import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";
import {
  DEFAULT_MODEL,
  groqChat,
  GroqApiError,
} from "@/lib/ai/groq";
import { getAdminFirestore } from "@/lib/firebase/admin";
import {
  enforceDailyAiQuota,
  logRedactions,
  peekMonthlyBudget,
  recordTokensAndCheckBudget,
  redactPii,
} from "@/lib/server/llm-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

const MIN_DOCS = 2;
const MAX_DOCS = 5;
const PER_DOC_CHARS = 5_000;

const SYSTEM_PROMPT = `You are Forge's "Crystallize" engine. The user has picked between 2 and 5 of their own documents. Your job is NOT to summarise them — summaries already exist. Your job is to find the THESIS hiding across the documents: the central argument that emerges when you read them together, and the open questions a careful reader would still have.

You receive each document labeled by its id and title. You output STRICT JSON with this shape, no markdown fences:

{
  "title":   "<one-line title for the synthesis, ≤ 12 words>",
  "thesis":  "<the central claim that emerges, 1–3 sentences>",
  "support": [
    { "docId": "<id from the input>", "span": "<verbatim sentence from that doc that supports the thesis>", "why": "<one short sentence>" }
  ],
  "counters": [
    { "docId": "<id from the input>", "span": "<verbatim sentence from that doc that complicates or weakens the thesis>", "why": "<one short sentence>" }
  ],
  "openQuestions": [
    "<a question a careful reader would ask that none of the docs answer, ≤ 18 words>"
  ],
  "whatToWriteNext": "<one short sentence on the single most useful doc the user should write next>"
}

Discipline:
  • Every "span" MUST be a verbatim substring of the cited doc. Copy exactly.
  • Use only docIds from the input. Never invent ids.
  • Aim for 3–5 support entries and 1–3 counters. Skip counters if the docs genuinely agree.
  • Aim for 2–4 open questions. Pick the ones that would most change the thesis if answered.
  • "whatToWriteNext" should be concrete and specific (not "you should think more about X").
  • If the docs are too disjoint to find a shared thesis, set thesis to "These documents don't converge on a single argument — they cover different topics." and keep support/counters minimal.

After the JSON, do not write anything else.`;

interface RawSupport {
  docId?: unknown;
  span?: unknown;
  why?: unknown;
}

interface RawPayload {
  title?: unknown;
  thesis?: unknown;
  support?: unknown;
  counters?: unknown;
  openQuestions?: unknown;
  whatToWriteNext?: unknown;
}

interface NormalizedDoc {
  id: string;
  title: string;
  text: string;
}

interface Body {
  projectId?: unknown;
  docIds?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireUser(req);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    req,
    { routeId: "crystallize", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(req, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  const docIds = Array.isArray(body.docIds)
    ? (body.docIds as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }
  if (docIds.length < MIN_DOCS || docIds.length > MAX_DOCS) {
    return NextResponse.json(
      { error: `Pick between ${MIN_DOCS} and ${MAX_DOCS} docs.` },
      { status: 400 },
    );
  }

  // Quota + budget gates.
  const quota = await enforceDailyAiQuota(auth.uid);
  if (!quota.ok) {
    return NextResponse.json({ error: quota.reason ?? "Daily limit." }, { status: 429 });
  }
  const budget = await peekMonthlyBudget();
  if (!budget.ok) {
    return NextResponse.json({ error: budget.reason ?? "Service paused." }, { status: 503 });
  }

  // Server-side admin pull. We filter by userId AND projectId so a
  // doc id from another user / project can't leak through this route.
  const fs = getAdminFirestore();
  const docs: NormalizedDoc[] = [];
  for (const id of docIds) {
    try {
      const snap = await fs.doc(`documents/${id}`).get();
      if (!snap.exists) continue;
      const data = snap.data() as {
        userId?: string;
        projectId?: string;
        title?: string;
        content?: string;
      };
      if (data.userId !== auth.uid) continue;
      if (data.projectId !== projectId) continue;
      const text = htmlToText(data.content ?? "").slice(0, PER_DOC_CHARS);
      if (!text.trim()) continue;
      docs.push({
        id,
        title: (data.title ?? "Untitled").slice(0, 120),
        text,
      });
    } catch {
      /* skip individual failures */
    }
  }
  if (docs.length < MIN_DOCS) {
    return NextResponse.json(
      { error: `Need ${MIN_DOCS} readable docs you own in this project.` },
      { status: 400 },
    );
  }

  // PII scrub each doc's body before it leaves the server.
  const tally = { email: 0, phone: 0, ssn: 0, creditCard: 0, apiKey: 0 };
  for (const d of docs) {
    const r = redactPii(d.text);
    d.text = r.text;
    for (const k of Object.keys(tally) as (keyof typeof tally)[]) {
      tally[k] += r.counts[k];
    }
  }
  logRedactions(`uid=${auth.uid} crystallize`, tally);

  const corpus = docs
    .map((d) => `### [${d.id}] ${d.title}\n"""${d.text}"""`)
    .join("\n\n");

  let groq;
  try {
    groq = await groqChat({
      model: DEFAULT_MODEL,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `${corpus}\n\nRespond with JSON only.`,
        },
      ],
      jsonResponse: true,
      maxCompletionTokens: 2_000,
      temperature: 0.2,
      timeoutMs: 30_000,
    });
  } catch (err) {
    const status = err instanceof GroqApiError ? err.status : 500;
    const message = err instanceof Error ? err.message : "unknown";
    console.error("[crystallize] upstream:", message);
    return NextResponse.json(
      { error: `Upstream: ${message}` },
      { status: status === 0 ? 502 : status },
    );
  }

  void recordTokensAndCheckBudget(groq.tokenUsage.total);

  const parsed = parsePayload(groq.content, docs);
  if (!parsed) {
    return NextResponse.json(
      { error: "Couldn't parse the synthesis. Try again." },
      { status: 502 },
    );
  }

  return NextResponse.json({
    title: parsed.title,
    thesis: parsed.thesis,
    support: parsed.support,
    counters: parsed.counters,
    openQuestions: parsed.openQuestions,
    whatToWriteNext: parsed.whatToWriteNext,
    bodyHtml: renderHtml(parsed),
    groq: {
      model: groq.model,
      durationMs: groq.durationMs,
      tokens: groq.tokenUsage,
    },
  });
}

/* ─────────────────────── helpers ─────────────────────── */

interface ParsedCrystal {
  title: string;
  thesis: string;
  support: Array<{ docId: string; span: string; why: string }>;
  counters: Array<{ docId: string; span: string; why: string }>;
  openQuestions: string[];
  whatToWriteNext: string;
}

function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|blockquote|pre|br)>/gi, ". ")
    .replace(/<br\s*\/?\s*>/gi, ". ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePayload(raw: string, docs: NormalizedDoc[]): ParsedCrystal | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let parsed: RawPayload;
  try {
    parsed = JSON.parse(cleaned) as RawPayload;
  } catch {
    return null;
  }
  const idSet = new Set(docs.map((d) => d.id));
  const docTextById = new Map(docs.map((d) => [d.id, d.text.toLowerCase()] as const));

  const validateList = (xs: unknown): RawSupport[] => (Array.isArray(xs) ? (xs as RawSupport[]) : []);

  const filterSpans = (xs: RawSupport[]) =>
    xs
      .map((x) => ({
        docId: typeof x.docId === "string" ? x.docId : "",
        span: typeof x.span === "string" ? x.span.trim() : "",
        why: typeof x.why === "string" ? x.why.trim().slice(0, 200) : "",
      }))
      .filter(
        (x) =>
          idSet.has(x.docId) &&
          x.span.length > 0 &&
          docTextById.get(x.docId)?.includes(x.span.toLowerCase()),
      )
      .slice(0, 6);

  return {
    title:
      typeof parsed.title === "string" && parsed.title.trim()
        ? parsed.title.trim().slice(0, 120)
        : "Crystallized synthesis",
    thesis:
      typeof parsed.thesis === "string" && parsed.thesis.trim()
        ? parsed.thesis.trim().slice(0, 800)
        : "No shared thesis emerged from these documents.",
    support: filterSpans(validateList(parsed.support)),
    counters: filterSpans(validateList(parsed.counters)),
    openQuestions: (Array.isArray(parsed.openQuestions) ? parsed.openQuestions : [])
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 6),
    whatToWriteNext:
      typeof parsed.whatToWriteNext === "string" && parsed.whatToWriteNext.trim()
        ? parsed.whatToWriteNext.trim().slice(0, 400)
        : "",
  };
}

/** Render the parsed synthesis as a TipTap-compatible HTML body so
 * the client can drop it straight into a new document. */
function renderHtml(c: ParsedCrystal): string {
  const parts: string[] = [];
  parts.push(`<h1>${esc(c.title)}</h1>`);
  parts.push(`<p><strong>Thesis.</strong> ${esc(c.thesis)}</p>`);
  if (c.support.length > 0) {
    parts.push(`<h2>What the docs argue</h2>`);
    parts.push("<ul>");
    for (const s of c.support) {
      parts.push(`<li>${esc(s.why)}<br><em>“${esc(s.span)}”</em></li>`);
    }
    parts.push("</ul>");
  }
  if (c.counters.length > 0) {
    parts.push(`<h2>What complicates it</h2>`);
    parts.push("<ul>");
    for (const s of c.counters) {
      parts.push(`<li>${esc(s.why)}<br><em>“${esc(s.span)}”</em></li>`);
    }
    parts.push("</ul>");
  }
  if (c.openQuestions.length > 0) {
    parts.push(`<h2>Still open</h2>`);
    parts.push("<ul>");
    for (const q of c.openQuestions) parts.push(`<li>${esc(q)}</li>`);
    parts.push("</ul>");
  }
  if (c.whatToWriteNext) {
    parts.push(`<h2>Write this next</h2>`);
    parts.push(`<p>${esc(c.whatToWriteNext)}</p>`);
  }
  return parts.join("");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
