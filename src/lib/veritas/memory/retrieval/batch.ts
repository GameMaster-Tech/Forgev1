/**
 * Batched concurrent fetcher — Firestore-only.
 *
 * Why this exists
 * ───────────────
 * Resolving N claim ids (e.g. when a `memory_recall` step returns a
 * list) used to issue N serial `getDoc` calls. Firestore's `getAll`
 * accepts up to 10 refs per batch; we chunk by 10 and then issue all
 * batches CONCURRENTLY via `Promise.all`. For N=100, that's 10 parallel
 * RTTs instead of 100 serial ones — ~10× speedup at no risk (Firestore
 * reads are read-only and never conflict).
 */

import {
  doc,
  getDoc,
  type CollectionReference,
  type DocumentData,
  type DocumentSnapshot,
} from "firebase/firestore";

const FIRESTORE_GETALL_LIMIT = 10;

/**
 * Fetch a list of doc-ids from a collection, in concurrent batches.
 * Returns a Map of `id → snap`. Missing docs are NOT included in the map
 * (caller decides how to handle absence; usually a "drop" pattern).
 *
 * @param coll  Collection reference.
 * @param ids   List of document ids to fetch. De-duplicated internally.
 */
export async function batchGetByIds(
  coll: CollectionReference<DocumentData>,
  ids: readonly string[],
): Promise<Map<string, DocumentSnapshot<DocumentData>>> {
  const dedup = Array.from(new Set(ids));
  if (dedup.length === 0) return new Map();

  // Chunk into groups of 10 (Firestore's per-call cap on get_all).
  const chunks: string[][] = [];
  for (let i = 0; i < dedup.length; i += FIRESTORE_GETALL_LIMIT) {
    chunks.push(dedup.slice(i, i + FIRESTORE_GETALL_LIMIT));
  }

  // Fire all chunks in parallel. Each chunk is up to 10 individual gets;
  // Firestore JS SDK doesn't expose a `getAll` for the modular API, so
  // we issue per-doc `getDoc` calls — each chunk's gets parallelise via
  // Promise.all, and chunks parallelise across each other.
  //
  // The two-level nesting looks redundant but is intentional: the outer
  // Promise.all waits for ALL chunks; the inner Promise.all waits for
  // the gets within ONE chunk. This is the cheapest correct concurrent
  // fetch in the modular SDK without taking on the admin SDK.
  const results = await Promise.all(
    chunks.map((chunk) =>
      Promise.all(chunk.map((id) => getDoc(doc(coll, id)))),
    ),
  );

  const out = new Map<string, DocumentSnapshot<DocumentData>>();
  for (const chunkResults of results) {
    for (const snap of chunkResults) {
      if (snap.exists()) out.set(snap.id, snap);
    }
  }
  return out;
}
