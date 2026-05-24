/**
 * POST /api/pulse/refactor/draft
 *
 * Groq-powered prose rewriter. Pulse's deterministic refactor proposer
 * produces a `before` body and a list of triggering assertions; this
 * route asks Llama 3.3 70B to draft an `after` body that:
 *   • Preserves the original voice and length envelope
 *   • Substitutes the new authoritative values
 *   • Keeps inline citations and structure intact
 *
 * Used by the Pulse Refactors detail page to upgrade a templated
 * proposal into a real rewrite. Stateless — caller owns the
 * before/after diff and the accept/reject flow.
 *
 * Security posture:
 *   • requireUser
 *   • RATE_LIMIT_EXPENSIVE
 *   • Each block capped at 8 000 chars; triggers capped at 20
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";
import { DEFAULT_MODEL, groqChat } from "@/lib/ai/groq";

const MAX_BLOCK_CHARS = 8_000;
const MAX_TRIGGERS = 20;

interface TriggerInput {
  label?: unknown;
  previousValue?: unknown;
  currentValue?: unknown;
  source?: unknown;
}

interface DraftBody {
  before?: unknown;
  triggers?: unknown;
  /** Optional hint about the doc this block sits in. */
  documentTitle?: unknown;
}

const SYSTEM_PROMPT = `You are Forge's prose rewriter. Pulse has detected that one or more values in the source data have changed; your job is to revise the block of prose so it reflects the new facts AND surface a structured diff so the UI can highlight every edit.

Strict rules:
- PRESERVE the original voice, paragraph structure, and approximate length (±15%).
- REPLACE only the values that have changed; do not invent new facts.
- KEEP any inline citation syntax (e.g. footnote markers, [[claim:…]] mentions) exactly as written.
- If a trigger's new value is unknown or missing, leave that phrase alone — do NOT fabricate.

Output format — STRICT JSON only, no markdown fences, no commentary:

{
  "after": "<full rewritten block>",
  "summary": "<one short sentence describing what changed and why, ≤ 25 words>",
  "edits": [
    {
      "trigger": "<label of the trigger this edit addresses, or \"general\" if none>",
      "beforeSpan": "<verbatim substring from the original block that you replaced>",
      "afterSpan":  "<verbatim substring from the new block that replaced it>",
      "reason":     "<one sentence on why this edit was needed>"
    }
  ],
  "confidence": "<one of: high, medium, low — your confidence the rewrite is faithful>"
}

Rules for the edits array:
- One entry per substantive change. If you just fixed a number, that's one edit. If you rewrote a clause, that's one edit.
- beforeSpan MUST be a verbatim substring of the ORIGINAL block.
- afterSpan MUST be a verbatim substring of your "after" string.
- Cap at 8 edits; collapse small adjacent edits into one if needed.
- If nothing actually changed, return { "after": "<original>", "summary": "No change needed", "edits": [], "confidence": "high" }.`;

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "pulse.refactor.draft", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  let body: DraftBody;
  try {
    body = (await request.json()) as DraftBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const before = typeof body.before === "string" ? body.before.trim() : "";
  if (!before) {
    return Response.json({ error: "before is required" }, { status: 400 });
  }
  if (before.length > MAX_BLOCK_CHARS) {
    return Response.json(
      { error: `before too long (max ${MAX_BLOCK_CHARS} chars)` },
      { status: 400 },
    );
  }
  const rawTriggers = Array.isArray(body.triggers) ? body.triggers : [];
  const triggers = rawTriggers
    .slice(0, MAX_TRIGGERS)
    .map((t) => t as TriggerInput)
    .filter((t) => typeof t.label === "string");

  const documentTitle =
    typeof body.documentTitle === "string"
      ? body.documentTitle.trim().slice(0, 120)
      : null;

  const triggerLines = triggers.length
    ? triggers
        .map((t, i) => {
          const label = String(t.label);
          const previous =
            t.previousValue == null ? "—" : String(t.previousValue);
          const current =
            t.currentValue == null ? "(unknown)" : String(t.currentValue);
          const source = typeof t.source === "string" ? ` · source: ${t.source}` : "";
          return `${i + 1}. ${label}: ${previous} → ${current}${source}`;
        })
        .join("\n")
    : "(no specific values listed; rewrite for general staleness)";

  const userPrompt = `Document context: ${documentTitle ?? "(unspecified)"}\n\nValues that changed:\n${triggerLines}\n\n--- ORIGINAL BLOCK ---\n${before}\n--- END BLOCK ---\n\nReturn ONLY the rewritten block.`;

  try {
    const result = await groqChat({
      model: DEFAULT_MODEL,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      maxCompletionTokens: 1500,
      temperature: 0.25,
      jsonResponse: true,
    });
    const parsed = parseDraft(result.content);
    if (!parsed) {
      return Response.json({ error: "Couldn't parse rewrite" }, { status: 502 });
    }
    if (!parsed.after) {
      return Response.json({ error: "Empty rewrite" }, { status: 502 });
    }
    return Response.json(parsed);
  } catch (err) {
    console.error("[pulse.refactor.draft] upstream failure", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return Response.json(
      { error: "Refactor draft failed" },
      { status: 500 },
    );
  }
}

interface DraftResult {
  after: string;
  summary: string;
  edits: Array<{
    trigger: string;
    beforeSpan: string;
    afterSpan: string;
    reason: string;
  }>;
  confidence: "high" | "medium" | "low";
}

function parseDraft(raw: string): DraftResult | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as Partial<DraftResult>;
    const after = typeof parsed.after === "string" ? parsed.after : "";
    if (!after) return null;
    const edits = Array.isArray(parsed.edits)
      ? parsed.edits.filter(
          (e): e is DraftResult["edits"][number] =>
            !!e &&
            typeof e === "object" &&
            typeof e.beforeSpan === "string" &&
            typeof e.afterSpan === "string",
        )
      : [];
    const confidence: DraftResult["confidence"] =
      parsed.confidence === "low" || parsed.confidence === "medium" || parsed.confidence === "high"
        ? parsed.confidence
        : "medium";
    return {
      after,
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      edits: edits.slice(0, 8),
      confidence,
    };
  } catch {
    return null;
  }
}
