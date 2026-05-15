/**
 * Cursor-based pagination helpers — Firestore-only.
 *
 * Why cursors over offsets
 * ────────────────────────
 * Firestore charges one read per document scanned, even discarded ones.
 * `offset(N)` reads N+pageSize docs and discards N. At page 50 of a
 * 25-row paginated list that's 1,250 reads to render 25 docs. Cursors
 * pin to a specific document (the last result of the previous page) and
 * scan only from there — O(pageSize) reads regardless of depth.
 *
 * The functions here are thin enough to live alongside the rest of the
 * retrieval module — they don't need their own service layer.
 */

import {
  startAfter,
  limit as firestoreLimit,
  type Query,
  type DocumentData,
  type QueryDocumentSnapshot,
  type QueryConstraint,
  query,
  getDocs,
} from "firebase/firestore";

export interface PaginatedResult<T> {
  rows: T[];
  /**
   * The last document of this page — pass back as `cursor` to fetch
   * the next page. `undefined` when there are no more rows.
   */
  cursor: QueryDocumentSnapshot<DocumentData> | undefined;
  /** True if there's likely a next page (we got a full pageSize). */
  hasMore: boolean;
}

/**
 * Run a paginated Firestore query, mapping each doc through `transform`.
 *
 * The caller passes a base Query and any `cursor` from a previous page;
 * we append `startAfter(cursor)` + `limit(pageSize)`. The `transform`
 * function maps `DocumentData` → row type T (typically domain converters
 * like `docToClaim`).
 */
export async function paginate<T>(
  baseQuery: Query<DocumentData>,
  transform: (data: DocumentData) => T,
  opts: {
    pageSize?: number;
    cursor?: QueryDocumentSnapshot<DocumentData>;
    extraConstraints?: QueryConstraint[];
  } = {},
): Promise<PaginatedResult<T>> {
  const pageSize = opts.pageSize ?? 25;
  const constraints: QueryConstraint[] = [
    ...(opts.extraConstraints ?? []),
    firestoreLimit(pageSize),
  ];
  if (opts.cursor) constraints.unshift(startAfter(opts.cursor));

  const paged = query(baseQuery, ...constraints);
  const snap = await getDocs(paged);
  const rows = snap.docs.map((d) => transform(d.data()));
  const lastDoc = snap.docs[snap.docs.length - 1];
  return {
    rows,
    cursor: snap.docs.length === pageSize ? lastDoc : undefined,
    hasMore: snap.docs.length === pageSize,
  };
}
