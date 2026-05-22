/**
 * LLM proxy hooks for the Forge Reactive Workspace.
 *
 *   • `embedText`              — POSTs to `/api/forge-graph/embed`, which
 *     fronts Voyage AI when a key is present and falls back to a
 *     deterministic locality-sensitive hash when offline.
 *
 *   • `checkProseContradiction` — POSTs to `/api/forge-graph/semantic-check`,
 *     which asks Anthropic whether two prose blocks contradict each
 *     other (not merely paraphrase).
 *
 * Both functions live on the client. They are wrapped so that the
 * compiler can swap them out for tests via the `EmbeddingProxy` and
 * `LlmValidationProxy` types.
 */

import { auth } from "@/lib/firebase/config";
import type { EmbeddingProxy, LlmValidationProxy } from "./types";

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  try {
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

/** Output dimensionality of the deterministic fallback embedding. */
export const FALLBACK_EMBEDDING_DIM = 256;

const EMBED_URL = "/api/forge-graph/embed";
const SEMANTIC_URL = "/api/forge-graph/semantic-check";

/**
 * Cache of recent embeddings keyed by content. Stops the
 * semantic-reactivity hot path from re-billing Voyage on every
 * keystroke (TipTap fires many onUpdates per second).
 */
class EmbeddingCache {
  private store = new Map<string, Float32Array>();
  private readonly capacity = 256;

  get(text: string): Float32Array | undefined {
    return this.store.get(text);
  }
  set(text: string, vec: Float32Array): void {
    if (this.store.size >= this.capacity) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }
    this.store.set(text, vec);
  }
  clear(): void {
    this.store.clear();
  }
}

const embeddingCache = new EmbeddingCache();

export const embedText: EmbeddingProxy = async (text: string) => {
  const trimmed = text.trim();
  if (!trimmed) return new Float32Array(0);
  const cached = embeddingCache.get(trimmed);
  if (cached) return cached;

  const headers = await authHeaders();
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ text: trimmed }),
  });
  if (!res.ok) {
    // Hard-fall back so a transient outage doesn't kill the editor UX.
    const vec = deterministicEmbedding(trimmed, FALLBACK_EMBEDDING_DIM);
    embeddingCache.set(trimmed, vec);
    return vec;
  }
  const data = (await res.json()) as { vector?: number[] };
  if (!Array.isArray(data.vector) || data.vector.length === 0) {
    const vec = deterministicEmbedding(trimmed, FALLBACK_EMBEDDING_DIM);
    embeddingCache.set(trimmed, vec);
    return vec;
  }
  const vec = new Float32Array(data.vector);
  embeddingCache.set(trimmed, vec);
  return vec;
};

export const checkProseContradiction: LlmValidationProxy = async (
  proseA: string,
  proseB: string,
) => {
  const headers = await authHeaders();
  const res = await fetch(SEMANTIC_URL, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ proseA, proseB }),
  });
  if (!res.ok) {
    return { conflict: false };
  }
  const data = (await res.json()) as { conflict?: boolean; reason?: string };
  return {
    conflict: data.conflict === true,
    reason: typeof data.reason === "string" ? data.reason : undefined,
  };
};

/** Reset the in-memory embedding cache (e.g. on project switch). */
export function clearEmbeddingCache(): void {
  embeddingCache.clear();
}

/* ───────────────────── deterministic fallback ─────────────────────
 *
 * A locality-sensitive hash over character n-grams. Good enough to
 * detect blatant prose duplication offline; meaningless for nuanced
 * semantic comparison. The server emits the same algorithm when its
 * upstream embedding provider is unavailable, so the cosine scores
 * computed in the compiler remain comparable across the boundary.
 */

export function deterministicEmbedding(text: string, dim: number): Float32Array {
  const vec = new Float32Array(dim);
  const lower = text.toLowerCase();
  const len = lower.length;
  if (len === 0) return vec;

  // 3-gram FNV-1a hashing into the vector; sign alternates by hash low
  // bit so different n-grams partially cancel rather than uniformly
  // pile up.
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

  // L2-normalise so the dot product yields a cosine.
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  if (norm === 0) return vec;
  const inv = 1 / Math.sqrt(norm);
  for (let i = 0; i < dim; i++) vec[i] *= inv;
  return vec;
}
