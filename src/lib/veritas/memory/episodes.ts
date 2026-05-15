/**
 * Episode Log — in-memory implementation (schema v2).
 *
 * Captures every meaningful project interaction:
 *   • Research queries
 *   • Writing / editing
 *   • Citation accept / reject
 *   • Contradiction surface / resolve
 *   • Memory snapshots
 *
 * The log becomes:
 *   (a) the memory the model recalls at inference time
 *   (b) the raw feedstock for DPO preference pairs in Phase 4
 *   (c) the structured thought-trace archive (training gold)
 */

import type {
  Episode,
  EpisodeType,
  ThoughtTrace,
} from "./schema";
import { newEpisodeId, isoNow } from "./ids";

export type NewEpisodeInput = Omit<Episode, "id" | "timestamp">;

export interface EpisodeLog {
  readonly projectId: string;

  append(input: NewEpisodeInput): Episode;

  /** Chronological list (oldest first). */
  list(): Episode[];

  /** Most recent k episodes (newest first). */
  recent(k: number): Episode[];

  ofType(type: EpisodeType): Episode[];

  /** Episodes touching a specific claim. */
  forClaim(claimId: string): Episode[];

  /** Episodes that mention a given keyword in input / output / traces. */
  search(query: string, limit?: number): Episode[];

  /** Every episode containing a structured thought trace. */
  withThoughtTraces(): Episode[];

  /** Full JSON export — used by the training data pipeline. */
  export(): Episode[];

  clear(): void;
}

export function createInMemoryEpisodeLog(projectId: string): EpisodeLog {
  const episodes: Episode[] = [];

  const matchesSearch = (e: Episode, q: string): boolean => {
    if (!q) return false;
    if (e.input.toLowerCase().includes(q)) return true;
    if (e.output && e.output.toLowerCase().includes(q)) return true;
    if (e.thoughtTrace && traceMatches(e.thoughtTrace, q)) return true;
    return false;
  };

  return {
    projectId,

    append(input) {
      const episode: Episode = {
        ...input,
        id: newEpisodeId(),
        timestamp: isoNow(),
        claimsReferenced: input.claimsReferenced ?? [],
        claimsCreated: input.claimsCreated ?? [],
        claimsRetired: input.claimsRetired ?? [],
        contradictionIds: input.contradictionIds ?? [],
      };
      episodes.push(episode);
      return episode;
    },

    list() {
      return [...episodes];
    },

    recent(k) {
      if (k <= 0) return [];
      return episodes.slice(-k).reverse();
    },

    ofType(type) {
      return episodes.filter((e) => e.type === type);
    },

    forClaim(claimId) {
      return episodes.filter(
        (e) =>
          e.claimsReferenced.includes(claimId) ||
          e.claimsCreated.includes(claimId) ||
          e.claimsRetired.includes(claimId),
      );
    },

    search(query, limit = 20) {
      const q = query.trim().toLowerCase();
      if (!q) return [];
      const hits: Episode[] = [];
      for (let i = episodes.length - 1; i >= 0; i--) {
        if (matchesSearch(episodes[i], q)) {
          hits.push(episodes[i]);
          if (hits.length >= limit) break;
        }
      }
      return hits;
    },

    withThoughtTraces() {
      return episodes.filter((e) => e.thoughtTrace && e.thoughtTrace.steps.length > 0);
    },

    export() {
      return [...episodes];
    },

    clear() {
      episodes.length = 0;
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 *  Helpers
 * ──────────────────────────────────────────────────────────── */

function traceMatches(trace: ThoughtTrace, q: string): boolean {
  for (const step of trace.steps) {
    if (step.text && step.text.toLowerCase().includes(q)) return true;
  }
  return false;
}
