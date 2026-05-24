/**
 * POST /api/tempo/explain
 *
 * Groq-powered placement-rationale generator. Tempo's planner already
 * produces deterministic priority factors (`deadline-proximity: +20`,
 * `goal-gravity: +12`, etc.); this route asks Llama 3.1 8B Instant to
 * translate those factors into one human-readable sentence per
 * placed item.
 *
 * Why FAST_MODEL: each rationale is a short generation task with low
 * nuance. Llama 3.1 8B Instant on Groq returns in ~200ms — fast
 * enough to fan out across a full plan without slowing the UI.
 *
 * Stateless. Caller sends a batch; the route returns a parallel array
 * of one-sentence rationales.
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";
import { FAST_MODEL, groqChat } from "@/lib/ai/groq";

const MAX_ITEMS = 12;

interface ItemInput {
  id?: unknown;
  title?: unknown;
  kind?: unknown;
  energy?: unknown;
  start?: unknown;
  end?: unknown;
  factors?: unknown;
}

interface ExplainBody {
  items?: unknown;
}

interface RationaleOut {
  id: string;
  sentence: string;
  factors: Array<{ label: string; weight: number }>;
  confidence: "high" | "medium" | "low";
}

const SYSTEM_PROMPT = `You are Tempo's planning explainer. For each scheduled item, return a one-line rationale AND a structured set of contributing factors so the UI can render them as chips.

Rules per item:
- Sentence: ≤ 20 words, plain English, second-person where natural ("you have a hard deadline…").
- Reference 1–2 of the most-relevant priority factors only.
- NEVER mention "algorithm", "model", "AI", or "heuristics" — describe the reason in human terms.
- Factors array: pick the 1–3 strongest signals from the input \`factors\` and re-emit each with a short \`label\` (3–4 words) and a normalized \`weight\` in [0, 1] reflecting how much that factor drove placement.
- Confidence: how confident you are the placement is right ("high" | "medium" | "low").

Respond with STRICT JSON only:
{
  "rationales": [
    {
      "id": "<input id>",
      "sentence": "<one short sentence>",
      "factors": [
        { "label": "<short label>", "weight": <number 0-1> }
      ],
      "confidence": "high" | "medium" | "low"
    }
  ]
}`;

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "tempo.explain", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  let body: ExplainBody;
  try {
    body = (await request.json()) as ExplainBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) {
    return Response.json({ rationales: [] });
  }
  if (rawItems.length > MAX_ITEMS) {
    return Response.json(
      { error: `too many items (max ${MAX_ITEMS})` },
      { status: 400 },
    );
  }

  const items = rawItems
    .map((raw) => raw as ItemInput)
    .filter((i): i is ItemInput & { id: string; title: string } =>
      typeof i.id === "string" && typeof i.title === "string",
    );
  if (items.length === 0) {
    return Response.json({ rationales: [] });
  }

  const compact = items
    .map((it, idx) => {
      const factors = Array.isArray(it.factors)
        ? it.factors
            .slice(0, 4)
            .map(
              (f) =>
                `${(f as { kind?: string }).kind ?? "factor"}:${(f as { contribution?: number }).contribution ?? 0}`,
            )
            .join(", ")
        : "—";
      return `${idx + 1}. id=${it.id} kind=${String(it.kind ?? "?")} energy=${String(it.energy ?? "?")} factors=[${factors}] title="${String(it.title).slice(0, 80)}"`;
    })
    .join("\n");

  try {
    const result = await groqChat({
      model: FAST_MODEL,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Items to explain:\n${compact}\n\nRespond with JSON only.`,
        },
      ],
      maxTokens: 512,
      temperature: 0.3,
      jsonResponse: true,
      timeoutMs: 12_000,
    });

    const rationales = parseRationales(result.content, items.map((i) => i.id as string));
    return Response.json({ rationales });
  } catch (err) {
    console.error("[tempo.explain] upstream failure", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return Response.json({ rationales: [] }, { status: 200 });
  }
}

function parseRationales(raw: string, ids: string[]): RationaleOut[] {
  if (!raw) return [];
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  interface RawR {
    id?: unknown;
    sentence?: unknown;
    factors?: unknown;
    confidence?: unknown;
  }
  let parsed: { rationales?: RawR[] };
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed.rationales) ? parsed.rationales : [];
  const idSet = new Set(ids);
  const out: RationaleOut[] = [];
  for (const r of list) {
    const id = typeof r.id === "string" ? r.id : "";
    const sentence = typeof r.sentence === "string" ? r.sentence.trim() : "";
    if (!id || !sentence || !idSet.has(id)) continue;
    const factors = Array.isArray(r.factors)
      ? r.factors
          .slice(0, 3)
          .map((f) => f as { label?: unknown; weight?: unknown })
          .filter((f): f is { label: string; weight: number } =>
            typeof f.label === "string" && typeof f.weight === "number",
          )
          .map((f) => ({
            label: f.label.slice(0, 40),
            weight: Math.max(0, Math.min(1, f.weight)),
          }))
      : [];
    const confidence: RationaleOut["confidence"] =
      r.confidence === "low" || r.confidence === "medium" || r.confidence === "high"
        ? r.confidence
        : "medium";
    out.push({ id, sentence: sentence.slice(0, 240), factors, confidence });
  }
  return out;
}
