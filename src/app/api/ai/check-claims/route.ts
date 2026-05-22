/**
 * POST /api/ai/check-claims — extracts claims from a draft via Groq
 * (Llama 3.3 70B).
 *
 * Security posture:
 *   • requireUser — Firebase ID token
 *   • enforceRateLimit — EXPENSIVE preset (Groq is metered)
 *   • Input validation — `text` must be a string between 40 and
 *     MAX_TEXT_CHARS characters.
 *   • Output is filtered: only claims whose text actually appears in the
 *     submitted draft are returned (guards against hallucinated quotes).
 *   • Errors are scrubbed before returning.
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";
import { DEFAULT_MODEL, groqChat } from "@/lib/ai/groq";

const MAX_TEXT_CHARS = 25_000;

/* ─── Types ─── */

export type ClaimSeverity = "high" | "medium" | "low";
export type ClaimKind =
  | "statistic"
  | "historical"
  | "scientific"
  | "attribution"
  | "causal"
  | "definition"
  | "opinion";

export interface ExtractedClaim {
  id: string;
  text: string;
  kind: ClaimKind;
  severity: ClaimSeverity;
  needsCitation: boolean;
  reasoning: string;
  suggestedQuery: string;
}

/* ─── Prompt ─── */

const systemPrompt = `You are a fact-checking analyst embedded in Forge, an AI research workspace where verification is the core brand promise. Your job is to read a researcher's draft and flag the specific factual claims that need a citation before publication.

You always respond with STRICT JSON matching this schema, nothing else:

{
  "claims": [
    {
      "text": "<exact verbatim sentence or clause from the document>",
      "kind": "statistic" | "historical" | "scientific" | "attribution" | "causal" | "definition" | "opinion",
      "severity": "high" | "medium" | "low",
      "needsCitation": true | false,
      "reasoning": "<one short sentence explaining why this needs a source>",
      "suggestedQuery": "<a crisp search query a researcher would paste into Google Scholar to find a source>"
    }
  ]
}

Rules:
- ONLY return JSON. No prose, no markdown fences, no commentary.
- Extract claims whose factual accuracy a careful reader would question.
- "text" MUST be a verbatim substring of the input — copy it exactly, including punctuation.
- Prefer 6–15 claims for a full draft; return fewer only if the text is short or low-density.
- severity=high: specific statistics, dates, named studies, strong causal claims, attributions to named people/institutions.
- severity=medium: general scientific assertions, historical generalizations, mechanism claims.
- severity=low: definitions, widely-known facts, rhetorical framing.
- needsCitation=true for high/medium. For low, only true if the claim is non-obvious.
- kind=opinion for subjective framing — flag but mark needsCitation=false.
- Do NOT flag personal narrative, transitions, questions, or instructions to the reader.
- suggestedQuery should read like something you'd search: "effect of caffeine on REM sleep meta-analysis", not full sentences.`;

/* ─── Handler ─── */

function extractJson(raw: string): string {
  // Strip markdown fences if the model adds them despite instructions
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first !== -1 && last !== -1) return raw.slice(first, last + 1);
  return raw.trim();
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "ai.check-claims", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  try {
    const { text } = (await request.json()) as { text?: string };

    if (!text || typeof text !== "string" || text.trim().length < 40) {
      return Response.json(
        { error: "Need at least 40 characters of text to check claims." },
        { status: 400 },
      );
    }
    if (text.length > MAX_TEXT_CHARS) {
      return Response.json(
        { error: `text too long (max ${MAX_TEXT_CHARS} chars)` },
        { status: 400 },
      );
    }

    const userPrompt = `Analyze the draft below and return the JSON described in your instructions. Remember: "text" values must be exact verbatim substrings.

--- DRAFT START ---
${text}
--- DRAFT END ---`;

    const result = await groqChat({
      model: DEFAULT_MODEL,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 2048,
      temperature: 0.2,
      jsonResponse: true,
    });
    const json = extractJson(result.content);

    let parsed: { claims?: Omit<ExtractedClaim, "id">[] };
    try {
      parsed = JSON.parse(json);
    } catch {
      // Do not log `raw` — it could contain reflected user input. Log
      // only the failure shape.
      console.error("[ai.check-claims] model returned malformed JSON");
      return Response.json(
        { error: "Model returned malformed response. Try again." },
        { status: 502 },
      );
    }

    const rawClaims = Array.isArray(parsed.claims) ? parsed.claims : [];

    // Keep only claims whose text is actually in the draft — guard against
    // hallucinated quotations. Case-insensitive but trimmed.
    const lowerText = text.toLowerCase();
    const claims: ExtractedClaim[] = rawClaims
      .filter(
        (c): c is Omit<ExtractedClaim, "id"> =>
          !!c &&
          typeof c.text === "string" &&
          c.text.trim().length > 0 &&
          lowerText.includes(c.text.trim().toLowerCase()),
      )
      .map((c, i) => ({
        id: `claim-${Date.now()}-${i}`,
        text: c.text.trim(),
        kind: (c.kind ?? "scientific") as ClaimKind,
        severity: (c.severity ?? "medium") as ClaimSeverity,
        needsCitation: c.needsCitation ?? true,
        reasoning: c.reasoning ?? "",
        suggestedQuery: c.suggestedQuery ?? c.text.trim(),
      }));

    return Response.json({ claims });
  } catch (err) {
    console.error("[ai.check-claims] upstream failure", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return Response.json(
      { error: "Claim checking failed. Please try again." },
      { status: 500 },
    );
  }
}
