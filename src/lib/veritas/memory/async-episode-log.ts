/**
 * Async Episode Log — interface parallel to `EpisodeLog` with Promise-returning
 * methods. Mirrors the approach in `async-claim-graph.ts`: the in-memory impl
 * stays sync for tests + ForgeBench, and Firestore / any other network-backed
 * store implements this shape.
 *
 * Semantics MUST match the sync interface step-for-step. Any implementation
 * divergence is a bug in that implementation — not in the interface.
 */

import type { Episode, EpisodeType } from "./schema";
import type { EpisodeLog, NewEpisodeInput } from "./episodes";
import { createInMemoryEpisodeLog } from "./episodes";

export interface AsyncEpisodeLog {
  readonly projectId: string;

  append(input: NewEpisodeInput): Promise<Episode>;

  /** Chronological list (oldest first). */
  list(): Promise<Episode[]>;

  /** Most recent k episodes (newest first). */
  recent(k: number): Promise<Episode[]>;

  ofType(type: EpisodeType): Promise<Episode[]>;

  /** Episodes touching a specific claim. */
  forClaim(claimId: string): Promise<Episode[]>;

  /** Episodes that mention a given keyword in input / output / traces. */
  search(query: string, limit?: number): Promise<Episode[]>;

  /** Every episode containing a structured thought trace. */
  withThoughtTraces(): Promise<Episode[]>;

  /** Full JSON export — used by the training data pipeline. */
  export(): Promise<Episode[]>;

  clear(): Promise<void>;
}

/**
 * Wrap a sync in-memory `EpisodeLog` in the async interface. Useful for tests
 * that want to exercise code paths written against `AsyncEpisodeLog` without
 * spinning up Firestore.
 */
export function asAsyncEpisodeLog(sync: EpisodeLog): AsyncEpisodeLog {
  return {
    projectId: sync.projectId,
    async append(input) { return sync.append(input); },
    async list() { return sync.list(); },
    async recent(k) { return sync.recent(k); },
    async ofType(type) { return sync.ofType(type); },
    async forClaim(id) { return sync.forClaim(id); },
    async search(q, limit) { return sync.search(q, limit); },
    async withThoughtTraces() { return sync.withThoughtTraces(); },
    async export() { return sync.export(); },
    async clear() { sync.clear(); },
  };
}

/**
 * Convenience: wrap a fresh in-memory log. Same signature as
 * `createInMemoryEpisodeLog` but returns the async shape.
 */
export function createInMemoryAsyncEpisodeLog(projectId: string): AsyncEpisodeLog {
  return asAsyncEpisodeLog(createInMemoryEpisodeLog(projectId));
}
