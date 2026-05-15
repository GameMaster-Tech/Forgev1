/**
 * Firestore collection names for Veritas memory entities.
 *
 * All veritas data is stored in flat root collections, partitioned by
 * `projectId` + `userId` (denormalised). Keeping collections flat (rather
 * than subcollection under `projects/{id}`) lets us:
 *   • use collectionGroup queries if we ever need cross-project aggregates
 *   • write simple security rules that only read `resource.data.userId`
 *     without needing `get(/databases/.../projects/...)`
 *
 * Every veritas doc MUST include:
 *   - `projectId` — partition key for all queries
 *   - `ownerId`   — user id that owns this record; enforced by security rules
 *
 * `ownerId` is denormalised from the parent project at write time by the
 * Firestore adapters. The pure in-memory impl never sees it.
 */

export const VERITAS_COLLECTIONS = {
  claims: "veritasClaims",
  claimLinks: "veritasClaimLinks",
  contradictions: "veritasContradictions",
  episodes: "veritasEpisodes",
  entities: "veritasEntities",
  topics: "veritasTopics",
  snapshots: "veritasSnapshots",
} as const;

export type VeritasCollection =
  (typeof VERITAS_COLLECTIONS)[keyof typeof VERITAS_COLLECTIONS];
