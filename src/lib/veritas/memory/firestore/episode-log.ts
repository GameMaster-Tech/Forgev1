/**
 * FirestoreEpisodeLog — production `AsyncEpisodeLog` backed by Firestore.
 *
 * Semantics match `createInMemoryEpisodeLog` step-for-step, with two
 * small-but-important divergences that are honest about the storage shape:
 *
 *   • `list()` is ordered by `timestamp ASC` on the Firestore side — the
 *     in-memory impl relies on insertion order, which matches timestamp
 *     order as long as the clock is monotonic. For practical purposes they
 *     are the same.
 *
 *   • `search()` still does client-side substring matching because Firestore
 *     has no full-text search. We cap it with `firestoreLimit` on the server
 *     and filter further in-memory. Phase 4 replaces this with a proper
 *     embedding / keyword index.
 *
 * Every write denormalises `ownerId` for security-rule enforcement — same
 * pattern as the claim-graph adapter.
 */

import {
  collection,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  writeBatch,
  deleteDoc,
  type Firestore,
  type DocumentData,
  type QueryConstraint,
} from "firebase/firestore";

import type { Episode, EpisodeType, ThoughtTrace } from "../schema";
import type { NewEpisodeInput } from "../episodes";
import type { AsyncEpisodeLog } from "../async-episode-log";
import { newEpisodeId, isoNow } from "../ids";
import { VERITAS_COLLECTIONS } from "./collections";
import { episodeToDoc, docToEpisode } from "./converters";

export interface FirestoreEpisodeLogOptions {
  db: Firestore;
  projectId: string;
  /** Owner uid — denormalised onto every write, enforced by security rules. */
  ownerId: string;
}

/** Match the in-memory search semantics — all three text channels. */
function matchesSearch(e: Episode, q: string): boolean {
  if (!q) return false;
  if (e.input.toLowerCase().includes(q)) return true;
  if (e.output && e.output.toLowerCase().includes(q)) return true;
  if (e.thoughtTrace && traceMatches(e.thoughtTrace, q)) return true;
  return false;
}

function traceMatches(trace: ThoughtTrace, q: string): boolean {
  for (const step of trace.steps) {
    if (step.text && step.text.toLowerCase().includes(q)) return true;
  }
  return false;
}

export function createFirestoreEpisodeLog(
  opts: FirestoreEpisodeLogOptions,
): AsyncEpisodeLog {
  const { db, projectId, ownerId } = opts;

  const epRef = collection(db, VERITAS_COLLECTIONS.episodes);
  const projectFilter = where("projectId", "==", projectId);

  async function runEpQuery(
    ...constraints: QueryConstraint[]
  ): Promise<Episode[]> {
    const snap = await getDocs(query(epRef, projectFilter, ...constraints));
    return snap.docs.map((d) => docToEpisode(d.data() as DocumentData));
  }

  return {
    projectId,

    async append(input: NewEpisodeInput): Promise<Episode> {
      const episode: Episode = {
        ...input,
        id: newEpisodeId(),
        timestamp: isoNow(),
        claimsReferenced: input.claimsReferenced ?? [],
        claimsCreated: input.claimsCreated ?? [],
        claimsRetired: input.claimsRetired ?? [],
        contradictionIds: input.contradictionIds ?? [],
      };
      const batch = writeBatch(db);
      batch.set(doc(epRef, episode.id), episodeToDoc(episode, ownerId));
      await batch.commit();
      return episode;
    },

    async list(): Promise<Episode[]> {
      return runEpQuery(orderBy("timestamp", "asc"));
    },

    async recent(k: number): Promise<Episode[]> {
      if (k <= 0) return [];
      return runEpQuery(orderBy("timestamp", "desc"), firestoreLimit(k));
    },

    async ofType(type: EpisodeType): Promise<Episode[]> {
      return runEpQuery(
        where("type", "==", type),
        orderBy("timestamp", "asc"),
      );
    },

    async forClaim(claimId: string): Promise<Episode[]> {
      // Firestore can't OR three `array-contains` constraints server-side.
      // Run three queries in parallel and dedup.
      const [refSnap, createdSnap, retiredSnap] = await Promise.all([
        getDocs(
          query(
            epRef,
            projectFilter,
            where("claimsReferenced", "array-contains", claimId),
          ),
        ),
        getDocs(
          query(
            epRef,
            projectFilter,
            where("claimsCreated", "array-contains", claimId),
          ),
        ),
        getDocs(
          query(
            epRef,
            projectFilter,
            where("claimsRetired", "array-contains", claimId),
          ),
        ),
      ]);
      const seen = new Set<string>();
      const out: Episode[] = [];
      for (const d of [...refSnap.docs, ...createdSnap.docs, ...retiredSnap.docs]) {
        const ep = docToEpisode(d.data() as DocumentData);
        if (seen.has(ep.id)) continue;
        seen.add(ep.id);
        out.push(ep);
      }
      // Preserve chronological order for stable UX.
      out.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      return out;
    },

    async search(queryStr: string, limit = 20): Promise<Episode[]> {
      const q = queryStr.trim().toLowerCase();
      if (!q) return [];
      // No full-text index yet — pull recent episodes, filter client-side.
      // Bounded by a generous cap so we don't stream the full project log.
      const candidates = await runEpQuery(
        orderBy("timestamp", "desc"),
        firestoreLimit(Math.max(limit * 10, 200)),
      );
      const hits: Episode[] = [];
      for (const e of candidates) {
        if (matchesSearch(e, q)) {
          hits.push(e);
          if (hits.length >= limit) break;
        }
      }
      return hits;
    },

    async withThoughtTraces(): Promise<Episode[]> {
      // Firestore has no "nested-field array length" filter. The most compact
      // filter we can push server-side is `thoughtTrace != null`; we then
      // filter for non-empty `steps` client-side.
      //
      // We skip the server-side inequality because it forces an index on
      // `thoughtTrace` and doesn't materially reduce bytes transferred for
      // the common case where most episodes carry traces. Full scan is fine
      // at the project-level volumes we expect in Phase 1.
      const all = await runEpQuery(orderBy("timestamp", "asc"));
      return all.filter((e) => e.thoughtTrace && e.thoughtTrace.steps.length > 0);
    },

    async export(): Promise<Episode[]> {
      return runEpQuery(orderBy("timestamp", "asc"));
    },

    async clear(): Promise<void> {
      // Bulk-delete every episode for this project. We cap the batch at 400
      // to stay well under the 500-op transaction limit and page through
      // if the project has more.
      //
      // This is a maintenance / test-cleanup path, not a hot read path.
      while (true) {
        const snap = await getDocs(
          query(epRef, projectFilter, firestoreLimit(400)),
        );
        if (snap.empty) return;
        // Deletes aren't transactional here because we may iterate multiple
        // pages; we accept eventual consistency under heavy concurrent writes
        // (which shouldn't happen during a clear call).
        await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
        if (snap.size < 400) return;
      }
    },
  };
}
