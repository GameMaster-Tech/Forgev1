/**
 * POST /api/forge-graph/embed
 *
 * Auth-required text embedding endpoint backing the Semantic Reactivity
 * layer. Routes to Voyage AI when `VOYAGE_API_KEY` is present, falls
 * back to a deterministic locality-sensitive hash when offline — the
 * fallback emits the same vector shape so the compiler's cosine math
 * is comparable across the boundary.
 *
 * Security posture mirrors `/api/ai/write`:
 *   • requireUser
 *   • RATE_LIMIT_EXPENSIVE (Voyage is metered, 20 req / 60s per user)
 *   • text size is hard-capped
 *   • response includes vector + dim only — no usage metadata, no key
 *     echo, no upstream error details
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";

const MAX_TEXT_CHARS = 8_000;
const FALLBACK_DIM = 256;
const VOYAGE_MODEL = "voyage-3";
const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_TIMEOUT_MS = 20_000;

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "forge-graph.embed", ...RATE_LIMIT_EXPENSIVE },
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
  if (!text) {
    return Response.json({ error: "text is required" }, { status: 400 });
  }
  if (text.length > MAX_TEXT_CHARS) {
    return Response.json(
      { error: `text too long (max ${MAX_TEXT_CHARS} chars)` },
      { status: 400 },
    );
  }

  const voyageKey = process.env.VOYAGE_API_KEY;
  if (voyageKey) {
    const vec = await embedViaVoyage(text, voyageKey);
    if (vec) {
      return Response.json({ vector: Array.from(vec), dim: vec.length, source: "voyage" });
    }
  }

  const vec = deterministicEmbedding(text, FALLBACK_DIM);
  return Response.json({ vector: Array.from(vec), dim: FALLBACK_DIM, source: "fallback" });
}

async function embedViaVoyage(text: string, apiKey: string): Promise<Float32Array | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), VOYAGE_TIMEOUT_MS);
  try {
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: [text],
        model: VOYAGE_MODEL,
        input_type: "document",
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn("[forge-graph.embed] voyage upstream", res.status);
      return null;
    }
    const data = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const first = data.data?.[0]?.embedding;
    if (!Array.isArray(first) || first.length === 0) return null;
    const vec = new Float32Array(first);
    l2Normalise(vec);
    return vec;
  } catch (err) {
    console.warn("[forge-graph.embed] voyage fetch failed", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function l2Normalise(vec: Float32Array): void {
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  if (norm === 0) return;
  const inv = 1 / Math.sqrt(norm);
  for (let i = 0; i < vec.length; i++) vec[i] *= inv;
}

/**
 * Mirror of the client-side fallback in `lib/forge-graph/llm-proxy.ts`.
 * Kept identical so a cached vector computed offline matches the server
 * vector once the user re-connects.
 */
function deterministicEmbedding(text: string, dim: number): Float32Array {
  const vec = new Float32Array(dim);
  const lower = text.toLowerCase();
  const len = lower.length;
  if (len === 0) return vec;

  for (let i = 0; i + 2 < len; i++) {
    let h = 0x811c9dc5;
    h = (h ^ lower.charCodeAt(i)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
    h = (h ^ lower.charCodeAt(i + 1)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
    h = (h ^ lower.charCodeAt(i + 2)) >>> 0;
    h = Math.imul(h, 0x01000193) >>> 0;
    const idx = h % dim;
    const sign = (h & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
  }

  l2Normalise(vec);
  return vec;
}
