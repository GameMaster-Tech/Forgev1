/**
 * Firestore adapters for Veritas memory.
 *
 * Public entry point — everything Firestore-specific funnels through here so
 * the rest of the app can do:
 *
 *   import { createFirestoreClaimGraph, createFirestoreEpisodeLog }
 *     from "@/lib/veritas/memory/firestore";
 *
 * ...without reaching into individual files.
 */

export { VERITAS_COLLECTIONS } from "./collections";
export type { VeritasCollection } from "./collections";

export {
  createFirestoreClaimGraph,
  type FirestoreClaimGraphOptions,
} from "./claim-graph";

export {
  createFirestoreEpisodeLog,
  type FirestoreEpisodeLogOptions,
} from "./episode-log";
