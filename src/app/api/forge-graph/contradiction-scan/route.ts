/**
 * POST /api/forge-graph/contradiction-scan
 *
 * Single-document contradiction scanner. The user types two
 * incompatible statements in the same doc — this endpoint finds them.
 *
 * Why one endpoint vs the per-pair `/semantic-check`:
 * pairwise O(n²) embedding + LLM calls are too slow on every doc
 * edit. Here we send the whole doc to Llama 3.3 70B in one shot and
 * ask it to return every contradicting pair as strict JSON. Single
 * round-trip, ~600–800ms typical.
 *
 * Security posture:
 *   • requireUser
 *   • RATE_LIMIT_EXPENSIVE — Groq is metered
 *   • Document text capped at 12 000 chars (≈ 2 000 words)
 *   • Output is structured pairs only; reasons capped at 200 chars
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";
import { DEFAULT_MODEL, groqChat, GroqApiError } from "@/lib/ai/groq";

const MAX_TEXT_CHARS = 12_000;
const MIN_TEXT_CHARS = 80; // skip if the doc is tiny

const SYSTEM_PROMPT = `You are Forge's contradiction scanner. You receive a single document and find every pair of statements within it that DIRECTLY CONTRADICT each other.

A contradiction means: a reasonable reader would conclude both statements cannot simultaneously be true. Examples that qualify:
  • "The deadline is May 12." vs "We ship on June 1."
  • "Our team is fully remote." vs "All meetings happen in the SF office."
  • "Sleep deprivation has no measurable cognitive effect." vs "Tired judges hand down harsher sentences."

The following do NOT qualify:
  • Paraphrases or restatements
  • Topic-adjacent statements that don't actually contradict
  • Hedged statements ("X may be true" doesn't contradict "X is sometimes false")
  • Numerical estimates within a reasonable range

Respond with STRICT JSON only — no prose, no markdown — matching:
{
  "contradictions": [
    {
      "spanA": "<verbatim sentence from the document>",
      "spanB": "<verbatim sentence from the document>",
      "reason": "<one short sentence explaining the contradiction, ≤ 25 words>"
    }
  ]
}

Rules:
- spanA and spanB MUST be verbatim substrings of the document — copy exactly.
- Return an empty contradictions array when nothing contradicts.
- Cap at 5 contradictions; pick the most clear-cut.
- Skip rhetorical, hypothetical, or questioning sentences.`;

interface RawContradiction {
  spanA?: unknown;
  spanB?: unknown;
  reason?: unknown;
}

export interface IntradocContradiction {
  spanA: string;
  spanB: string;
  reason: string;
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "forge-graph.contradiction-scan", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  let body: { text?: unknown };
  try {
    body = (await request.json()) as { text?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length < MIN_TEXT_CHARS) {
    // Not enough content to find contradictions.
    return Response.json({ contradictions: [] });
  }
  if (text.length > MAX_TEXT_CHARS) {
    return Response.json(
      { error: `text too long (max ${MAX_TEXT_CHARS} chars)` },
      { status: 400 },
    );
  }

  try {
    const result = await groqChat({
      model: DEFAULT_MODEL,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Document:\n"""${text}"""\n\nRespond with JSON only.`,
        },
      ],
      maxCompletionTokens: 1024,
      temperature: 0.15,
      jsonResponse: true,
      timeoutMs: 20_000,
    });

    const contradictions = parsePayload(result.content, text);
    return Response.json({ contradictions });
  } catch (err) {
    console.error("[forge-graph.contradiction-scan] upstream failure", {
      message: err instanceof Error ? err.message : "unknown",
    });
    const message = err instanceof Error ? err.message : "unknown";
    const status = err instanceof GroqApiError ? err.status : 0;
    return Response.json(
      {
        contradictions: [],
        error: `Upstream: ${message}`,
      },
      { status: status === 0 ? 502 : status },
    );
  }
}

/**
 * Validate every spanA / spanB is actually a verbatim substring of
 * the source. The model is instructed to copy exact text, but we
 * defend against hallucination either way — drift here would create
 * confusing UI markers pointing at text that isn't in the doc.
 */
function parsePayload(raw: string, source: string): IntradocContradiction[] {
  if (!raw) return [];
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  let parsed: { contradictions?: RawContradiction[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed.contradictions) ? parsed.contradictions : [];
  const lowerSource = source.toLowerCase();
  const out: IntradocContradiction[] = [];
  for (const c of list.slice(0, 5)) {
    const spanA = typeof c.spanA === "string" ? c.spanA.trim() : "";
    const spanB = typeof c.spanB === "string" ? c.spanB.trim() : "";
    const reason = typeof c.reason === "string" ? c.reason.trim().slice(0, 200) : "";
    if (!spanA || !spanB || spanA === spanB) continue;
    // Verbatim substring check (case-insensitive).
    if (
      !lowerSource.includes(spanA.toLowerCase()) ||
      !lowerSource.includes(spanB.toLowerCase())
    ) {
      continue;
    }
    out.push({ spanA, spanB, reason });
  }
  return out;
}
