/**
 * Embedder — narrow interface for turning text into a dense vector.
 *
 * We deliberately keep the interface tiny so any embedding stack drops in:
 *   • Voyage 3 (Anthropic-recommended for retrieval)        — production default
 *   • BGE-M3 / E5-Mistral served from vLLM                  — self-hosted next to Veritas-R1
 *   • OpenAI text-embedding-3-large                         — alt commercial path
 *   • Local sentence-transformers via a Modal/Replicate fn  — dev fallback
 *
 * Implementations MUST:
 *   1. Return a fixed-dimensional vector (`dim` must be stable across calls)
 *   2. L2-normalise the vector (so dot product == cosine similarity)
 *   3. Be deterministic for the same input (no random projection)
 *
 * Implementations MAY batch internally — the consumer pattern is `embed`
 * one-at-a-time during writes, with bulk re-embed jobs going through
 * `embedBatch`. Defaults provided so callers don't have to implement both.
 */

export interface Embedding {
  /** Dense vector — L2-normalised. */
  vector: number[];
  /** Vector dimensionality. Stable across calls for a given Embedder. */
  dim: number;
  /** Identifier of the model that produced the vector — stored on each row. */
  modelId: string;
}

export interface Embedder {
  readonly modelId: string;
  readonly dim: number;
  embed(text: string): Promise<Embedding>;
  embedBatch(texts: string[]): Promise<Embedding[]>;
}

/**
 * Reference base — implementations only override `embed` and inherit
 * a serial `embedBatch`. Override `embedBatch` for stacks that support
 * native batching (Voyage / OpenAI / vLLM `/embeddings`).
 */
export abstract class BaseEmbedder implements Embedder {
  abstract readonly modelId: string;
  abstract readonly dim: number;
  abstract embed(text: string): Promise<Embedding>;

  async embedBatch(texts: string[]): Promise<Embedding[]> {
    const out: Embedding[] = new Array(texts.length);
    for (let i = 0; i < texts.length; i++) {
      out[i] = await this.embed(texts[i]);
    }
    return out;
  }
}

/* ─────────────────────────────────────────────────────────────
 *  Vector math — shared by every backend (server + client side)
 * ──────────────────────────────────────────────────────────── */

/** L2-normalise a vector in place. Returns the same array for chaining. */
export function l2Normalise(v: number[]): number[] {
  let sumSq = 0;
  for (const x of v) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (norm === 0 || !Number.isFinite(norm)) return v;
  for (let i = 0; i < v.length; i++) v[i] = v[i] / norm;
  return v;
}

/**
 * Cosine similarity in [-1, 1]. Assumes both inputs are L2-normalised
 * (then this collapses to a dot product). If either side is NOT normalised
 * the score is still meaningful but loses the [-1, 1] bound.
 */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/* ─────────────────────────────────────────────────────────────
 *  Dev fallback — hashed-bag-of-words deterministic embedder.
 *  NOT for production retrieval; use Voyage / BGE-M3 instead.
 *
 *  Why ship a deterministic dev embedder at all?
 *    • Lets `findSimilar` be exercised end-to-end in the integration test
 *      without an embedding API key, while still using the semantic-recall
 *      code path (vector storage + cosine + ranking).
 *    • Provides a reproducible baseline so the bench-runner can score
 *      retrieval-aware tasks offline.
 * ──────────────────────────────────────────────────────────── */

export class HashEmbedder extends BaseEmbedder {
  readonly modelId: string;
  readonly dim: number;

  constructor(opts: { dim?: number; modelId?: string } = {}) {
    super();
    this.dim = opts.dim ?? 256;
    this.modelId = opts.modelId ?? `hash-bow-${this.dim}`;
  }

  async embed(text: string): Promise<Embedding> {
    const v = new Array<number>(this.dim).fill(0);
    const tokens = tokenise(text);
    for (const t of tokens) {
      const h = hash32(t) % this.dim;
      const sign = (hash32(`${t}|sign`) & 1) === 0 ? 1 : -1;
      v[h] += sign;
    }
    l2Normalise(v);
    return { vector: v, dim: this.dim, modelId: this.modelId };
  }
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "in", "is", "it", "its", "of", "on", "or", "that", "the", "to", "was", "were",
  "with", "this", "these", "those", "we", "our", "their", "they", "them", "but",
]);

function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function hash32(s: string): number {
  // FNV-1a 32-bit — same primitive used in `ids.ts` so retrieval and dedup
  // stay aligned. Always non-negative.
  let h = 0x811c9dc5 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
