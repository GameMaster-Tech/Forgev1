/**
 * Workspace retrieval — public surface.
 *
 * Forge is an AI-powered workspace. Retrieval spans every searchable
 * artefact in a project (documents, queries, claims, episodes, the
 * project itself), not just citations. See `docs/RETRIEVAL_ARCHITECTURE.md`
 * for the full design + decision rationale.
 *
 * Three call shapes exported here:
 *   • `searchWorkspace`      — general full-corpus search
 *   • `commandPaletteSearch` — title-prefix-first, ⌘K
 *   • `aiContextSearch`      — diverse-by-kind, used for AI prompt assembly
 *
 * Every write that mutates an indexable collection MUST call
 * `workspaceCache.invalidate(projectId)` so the next read sees fresh data.
 */

export type {
  WorkspaceItem,
  WorkspaceItemKind,
  SearchResult,
  SearchOptions,
} from "./types";

export {
  loadWorkspaceItems,
  adaptDocument,
  adaptQuery,
  adaptClaim,
  adaptEpisode,
  adaptProject,
  stripTipTap,
} from "./ingest";

export {
  searchWorkspace,
  commandPaletteSearch,
  aiContextSearch,
} from "./search";

export { workspaceCache } from "./cache";

// Lower-level primitives are still available under the original Veritas
// retrieval module for the claim-graph-specific path; the workspace
// surface above wraps them.
export {
  buildIndex,
  scoreQuery,
  tokenise,
} from "@/lib/veritas/memory/retrieval/bm25";

export { paginate } from "@/lib/veritas/memory/retrieval/cursor";
export { batchGetByIds } from "@/lib/veritas/memory/retrieval/batch";
