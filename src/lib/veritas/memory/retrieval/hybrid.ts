/**
 * Hybrid retriever — BM25 prefilter + cosine rerank.
 *
 * Pipeline:
 *   1. Build (or fetch from cache) the project's BM25 index.
 *   2. Score the probe text against BM25 → top-K candidates.
 *   3. If a probe embedding is provided AND candidates have inline
 *      embeddings, cosine-rerank the candidates.
 *   4. Final mix: 0.7 × cosine + 0.3 × normalised BM25.
 *   5. Return top-N with provenance.
 *
 * Designed to be **call-site-agnostic** — the in-memory ClaimGraph and
 * the Firestore ClaimGraph both call this with the same surface.
 */

import type { Claim } from "../schema";
import { cosine } from "../embeddings/embedder";
import { buildIndex, scoreQuery, type BM25Index } from "./bm25";
import { bm25Cache } from "./cache";

export interface HybridSearchOptions {
  /** Final result cap. Default 5. */
  limit?: number;
  /** BM25 prefilter cap. Default 50. */
  topK?: number;
  /**
   * Optional probe embedding (L2-normalised). When present, cosine
   * rerank fires on the BM25 top-K. When absent, BM25 score alone
   * determines the final ranking.
   */
  probeEmbedding?: number[];
  /**
   * Cosine weight in the final mix. Default 0.7. The BM25 weight is
   * `1 - cosineWeight`. Values outside [0, 1] are clamped.
   */
  cosineWeight?: number;
  /**
   * If true, skip the cache and rebuild the index inline. Used when
   * the caller knows the cache is stale (e.g. write-then-read in the
   * same request).
   */
  forceRebuild?: boolean;
}

export interface HybridSearchResult {
  claim: Claim;
  /** Final mixed score in roughly [0, 1] (not strictly bounded). */
  score: number;
  /** Cosine similarity, if cosine fired. */
  cosineScore?: number;
  /** BM25 score (raw, not normalised). */
  bm25Score: number;
  /** Stage that surfaced this candidate. */
  via: "hybrid" | "bm25" | "cosine";
}

/**
 * Run the hybrid retrieval pipeline.
 *
 * @param projectId  Used as the cache key — every project has its own BM25 index.
 * @param probeText  Free-text query for BM25.
 * @param claims     The full set of NON-RETIRED claims for the project.
 *                   Caller supplies because retrieval logic stays
 *                   storage-agnostic — the in-memory graph passes a
 *                   `Map.values()` array; Firestore graph passes a
 *                   query result.
 * @param opts       See `HybridSearchOptions`.
 */
export function hybridSearch(
  projectId: string,
  probeText: string,
  claims: Claim[],
  opts: HybridSearchOptions = {},
): HybridSearchResult[] {
  const limit = opts.limit ?? 5;
  const topK = opts.topK ?? 50;
  const cosineW = clamp01(opts.cosineWeight ?? 0.7);
  const bm25W = 1 - cosineW;

  // ── Stage 1: BM25 index (cached) ────────────────────────────────
  let index = opts.forceRebuild ? undefined : bm25Cache.get(projectId);
  if (!index) {
    index = buildIndex(
      claims.map((c) => ({ id: c.id, text: c.atomicAssertion })),
    );
    bm25Cache.set(projectId, index);
  }

  // ── Stage 2: BM25 score → top-K ─────────────────────────────────
  const bm25Scored = scoreQuery(index, probeText);
  if (bm25Scored.length === 0 && !opts.probeEmbedding) {
    return [];
  }

  // Lookup map for resolving ids → full claim objects
  const byId = new Map(claims.map((c) => [c.id, c]));

  // BM25 max for normalisation in the final mix
  const maxBm25 = bm25Scored[0]?.score ?? 1;
  const candidates = bm25Scored.slice(0, topK);

  // ── Stage 3: cosine rerank if probe embedding provided ──────────
  if (opts.probeEmbedding) {
    const reranked: HybridSearchResult[] = [];
    for (const cand of candidates) {
      const claim = byId.get(cand.id);
      if (!claim) continue;
      const emb = claim.embedding;
      const bm25Norm = maxBm25 > 0 ? cand.score / maxBm25 : 0;
      if (emb && emb.dim === opts.probeEmbedding.length) {
        const cs = cosine(opts.probeEmbedding, emb.vector);
        // Cosine in [-1, 1]; clamp negatives to 0 (anti-similar isn't useful here)
        const csClamped = Math.max(0, cs);
        reranked.push({
          claim,
          score: cosineW * csClamped + bm25W * bm25Norm,
          cosineScore: cs,
          bm25Score: cand.score,
          via: "hybrid",
        });
      } else {
        // Candidate has no embedding — fall back to BM25 alone, but
        // multiply by 0.5 so an embedded match always ranks above
        // a non-embedded one with comparable lexical score.
        reranked.push({
          claim,
          score: bm25W * bm25Norm * 0.5,
          bm25Score: cand.score,
          via: "bm25",
        });
      }
    }

    // ── Cosine-only safety net ──────────────────────────────────
    // If no probe text was supplied (BM25 returned 0 candidates) but a
    // probe embedding was, fall through to cosine over all claims.
    if (reranked.length === 0) {
      for (const claim of claims) {
        const emb = claim.embedding;
        if (!emb || emb.dim !== opts.probeEmbedding.length) continue;
        const cs = cosine(opts.probeEmbedding, emb.vector);
        if (cs > 0) {
          reranked.push({
            claim,
            score: cs,
            cosineScore: cs,
            bm25Score: 0,
            via: "cosine",
          });
        }
      }
    }

    reranked.sort((a, b) => b.score - a.score);
    return reranked.slice(0, limit);
  }

  // ── BM25-only path ──────────────────────────────────────────────
  const bm25Only: HybridSearchResult[] = [];
  for (const c of candidates) {
    const claim = byId.get(c.id);
    if (!claim) continue;
    bm25Only.push({
      claim,
      score: maxBm25 > 0 ? c.score / maxBm25 : 0,
      bm25Score: c.score,
      via: "bm25",
    });
  }
  return bm25Only.slice(0, limit);
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0.7;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
