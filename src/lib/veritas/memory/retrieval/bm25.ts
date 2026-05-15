/**
 * BM25 — Okapi BM25 lexical scorer.
 *
 * Pure-TS, zero-dep, tuned for the per-project corpus sizes Forge sees
 * (10²-10⁴ claims). Not a full-text search engine — a single-field
 * scorer over the claim's `atomicAssertion` text. We compute term-
 * frequency tables once per project and cache the index across calls.
 *
 * Why we use BM25 + cosine and not just one or the other
 * ──────────────────────────────────────────────────────
 *   • BM25 alone misses paraphrases ("statin lowers LDL" vs "atorvastatin
 *     reduces low-density lipoprotein") — devastating for memory recall.
 *   • Cosine alone misses exact-quote queries — common when the user
 *     pastes a source sentence to find the matching extracted claim.
 *   • Hybrid wins on both — BM25 prefilters to ~50 candidates, cosine
 *     reranks. Standard recipe in OpenScholar / ColBERT-v2.
 *
 * Constants
 * ─────────
 *   k1 = 1.2  (term-frequency saturation)
 *   b  = 0.75 (length normalisation)
 *
 * These are the canonical Okapi values. We deliberately don't expose
 * them as knobs — premature tuning on small corpora is noise.
 */

import { canonicaliseText } from "../ids";

const K1 = 1.2;
const B = 0.75;

// Stopwords — tracked here rather than imported from the existing
// `claim-graph.ts` STOPWORDS constant because we want the BM25 module
// to be importable in isolation (tests, future server packages).
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "in", "is", "it", "its", "of", "on", "or", "that", "the", "to", "was", "were",
  "with", "this", "these", "those", "we", "our", "their", "they", "them", "but",
  "if", "then", "when", "while", "so", "do", "does", "did",
]);

export interface BM25Doc {
  /** Stable identifier — usually the claim id; opaque to BM25. */
  id: string;
  /** Tokenised + canonicalised assertion text. */
  tokens: string[];
}

export interface BM25Index {
  /** Number of docs in the corpus. */
  N: number;
  /** Average document length. */
  avgDocLen: number;
  /** doc id → token count (for length normalisation). */
  docLen: Map<string, number>;
  /** doc id → token → tf (term frequency in this doc). */
  termFreq: Map<string, Map<string, number>>;
  /** token → df (number of docs containing this token). */
  docFreq: Map<string, number>;
}

/**
 * Tokenise — same canonicalisation pipeline `canonicalHash` uses, then
 * stopword filter + min-length-3 filter. Keeps lookups consistent with
 * the rest of the schema.
 */
export function tokenise(s: string): string[] {
  const canonical = canonicaliseText(s);
  return canonical
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

/**
 * Build a BM25 index from a list of {id, atomicAssertion}-shaped docs.
 * O(total_tokens). For 10⁴ claims with ~25 tokens each, ≈250k token
 * passes — sub-50 ms on Cloud Run / Node 22.
 */
export function buildIndex(docs: { id: string; text: string }[]): BM25Index {
  const docLen = new Map<string, number>();
  const termFreq = new Map<string, Map<string, number>>();
  const docFreq = new Map<string, number>();
  let totalLen = 0;

  for (const d of docs) {
    const toks = tokenise(d.text);
    docLen.set(d.id, toks.length);
    totalLen += toks.length;

    const tf = new Map<string, number>();
    const seenInDoc = new Set<string>();
    for (const t of toks) {
      tf.set(t, (tf.get(t) ?? 0) + 1);
      if (!seenInDoc.has(t)) {
        seenInDoc.add(t);
        docFreq.set(t, (docFreq.get(t) ?? 0) + 1);
      }
    }
    termFreq.set(d.id, tf);
  }

  return {
    N: docs.length,
    avgDocLen: docs.length === 0 ? 0 : totalLen / docs.length,
    docLen,
    termFreq,
    docFreq,
  };
}

/**
 * Score a query against the index. Returns a list of {id, score} pairs
 * for docs with score > 0, sorted descending. Top-K filtering is the
 * caller's job — usually `topK = 50` for the rerank pipeline.
 */
export function scoreQuery(
  index: BM25Index,
  queryText: string,
): { id: string; score: number }[] {
  const queryTokens = tokenise(queryText);
  if (queryTokens.length === 0 || index.N === 0) return [];

  const scores = new Map<string, number>();
  for (const term of queryTokens) {
    const df = index.docFreq.get(term);
    if (!df) continue;
    // Robertson-Spärck Jones IDF with the +1 smoothing that prevents
    // negative IDF on very common terms (when df > N/2).
    const idf = Math.log(1 + (index.N - df + 0.5) / (df + 0.5));

    for (const [docId, tf] of index.termFreq) {
      const f = tf.get(term);
      if (!f) continue;
      const dl = index.docLen.get(docId) ?? 0;
      const norm = 1 - B + B * (dl / (index.avgDocLen || 1));
      const tfPart = (f * (K1 + 1)) / (f + K1 * norm);
      scores.set(docId, (scores.get(docId) ?? 0) + idf * tfPart);
    }
  }

  return Array.from(scores.entries())
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}
