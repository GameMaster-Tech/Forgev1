/**
 * POST /api/forge-graph/semantic-check
 *
 * Groq-backed contradiction detector for the Semantic Reactivity
 * layer. Given two prose blocks, the model returns a strict JSON
 * verdict of whether block A *contradicts* block B (not merely
 * overlaps or paraphrases). Used by the ForgeSyncCompiler after
 * vector similarity has narrowed candidates.
 *
 * Why Groq here: Llama 3.1 8B Instant gives sub-500ms responses for
 * this short classification task, which keeps the editor's
 * debounce-then-check loop snappy. Output is constrained to strict
 * JSON via the OpenAI-compatible `response_format` field.
 *
 * Security posture:
 *   • requireUser
 *   • RATE_LIMIT_EXPENSIVE
 *   • Each block capped at 6 000 chars
 *   • Output is strictly { conflict, reason } — no usage stats
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";
import { groqChat, FAST_MODEL } from "@/lib/ai/groq";

const MAX_BLOCK_CHARS = 6_000;

const SYSTEM_PROMPT = `You are the Forge Semantic Reactivity judge. You receive two prose blocks from the same workspace and decide whether block A directly CONTRADICTS block B.

A contradiction means: a reasonable reader would conclude both statements cannot simultaneously be true. Paraphrases, partial overlaps, and topic-adjacent statements are NOT contradictions.

Respond with STRICT JSON only — no prose, no markdown — matching:
  {"conflict": boolean, "reason": string}

When "conflict" is true, "reason" must briefly cite the contradicting clauses (≤ 25 words). When false, return reason: "".`;

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "forge-graph.semantic-check", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  let body: { proseA?: unknown; proseB?: unknown };
  try {
    body = (await request.json()) as { proseA?: unknown; proseB?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const proseA = typeof body.proseA === "string" ? body.proseA.trim() : "";
  const proseB = typeof body.proseB === "string" ? body.proseB.trim() : "";
  if (!proseA || !proseB) {
    return Response.json({ error: "Both proseA and proseB are required" }, { status: 400 });
  }
  if (proseA.length > MAX_BLOCK_CHARS || proseB.length > MAX_BLOCK_CHARS) {
    return Response.json(
      { error: `prose too long (max ${MAX_BLOCK_CHARS} chars per block)` },
      { status: 400 },
    );
  }

  try {
    const result = await groqChat({
      model: FAST_MODEL,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Block A:\n"""${proseA}"""\n\nBlock B:\n"""${proseB}"""\n\nRespond with JSON only.`,
        },
      ],
      maxTokens: 256,
      temperature: 0.1,
      jsonResponse: true,
      timeoutMs: 15_000,
    });
    const parsed = parseVerdict(result.content);
    return Response.json(parsed);
  } catch (err) {
    console.error("[forge-graph.semantic-check] upstream failure", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return Response.json({ conflict: false, reason: "" }, { status: 200 });
  }
}

function parseVerdict(raw: string): { conflict: boolean; reason: string } {
  if (!raw) return { conflict: false, reason: "" };
  // The model occasionally wraps JSON in a fenced code block even
  // with response_format set. Strip the common variants before parse.
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as { conflict?: unknown; reason?: unknown };
    return {
      conflict: parsed.conflict === true,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  } catch {
    // Heuristic fallback for non-JSON model output.
    const lower = cleaned.toLowerCase();
    const conflict = /^\s*(yes|true|conflict)/.test(lower);
    return { conflict, reason: conflict ? cleaned.slice(0, 240) : "" };
  }
}
