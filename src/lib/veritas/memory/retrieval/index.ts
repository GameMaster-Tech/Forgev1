/**
 * Retrieval — barrel.
 *
 * Hybrid lexical + semantic retrieval for the Veritas claim graph.
 * Decision rationale + benchmarks: `docs/RETRIEVAL_ARCHITECTURE.md`.
 */

export {
  buildIndex,
  scoreQuery,
  tokenise,
  type BM25Index,
  type BM25Doc,
} from "./bm25";

export { BM25Cache, bm25Cache } from "./cache";

export {
  hybridSearch,
  type HybridSearchOptions,
  type HybridSearchResult,
} from "./hybrid";

export { paginate, type PaginatedResult } from "./cursor";

export { batchGetByIds } from "./batch";
