/**
 * Async Claim Graph — interface parallel to `ClaimGraph`, but every method is
 * Promise-returning. Firestore, pgvector, and any other network-backed store
 * implement this shape. The in-memory `ClaimGraph` is trivially adapted to
 * async via `asAsyncClaimGraph()` for tests that want to hit the same seams.
 *
 * Why a separate interface?
 * ─────────────────────────
 * We could have made `ClaimGraph` async from the start and forced the in-
 * memory impl to return already-resolved promises. In practice that:
 *   • costs allocations on a hot path (contradiction detection runs thousands
 *     of lookups per episode)
 *   • makes the unit-test surface noisier (every `addClaim` becomes an await)
 *
 * Keeping both shapes lets us have:
 *   - sync in-memory: fast, no-IO, used in ForgeBench + unit tests
 *   - async Firestore: production, used by the running app
 *
 * Semantics MUST match the sync interface step-for-step. Any implementation
 * divergence is a bug in that implementation — not in the interface.
 */

import type {
  Claim,
  ClaimLink,
  Contradiction,
} from "./schema";
import type {
  NewClaimInput,
  NewClaimLinkInput,
  NewContradictionInput,
  ClaimGraph,
} from "./claim-graph";
import { createInMemoryClaimGraph } from "./claim-graph";
import type { Embedder } from "./embeddings/embedder";

export interface AsyncClaimGraph {
  readonly projectId: string;

  addClaim(input: NewClaimInput): Promise<Claim>;

  getClaim(id: string): Promise<Claim | undefined>;
  getByHash(hash: string): Promise<Claim | undefined>;

  listClaims(opts?: { includeRetired?: boolean }): Promise<Claim[]>;
  listByTopic(topicId: string): Promise<Claim[]>;
  listByEntity(entityId: string): Promise<Claim[]>;

  updateClaim(
    id: string,
    patch: Partial<Omit<Claim, "id" | "projectId" | "canonicalHash">>,
  ): Promise<Claim | undefined>;

  retireClaim(id: string): Promise<void>;

  supersede(oldId: string, newId: string): Promise<void>;

  addLink(input: NewClaimLinkInput): Promise<ClaimLink>;
  linksFrom(id: string): Promise<ClaimLink[]>;
  linksTo(id: string): Promise<ClaimLink[]>;

  addContradiction(input: NewContradictionInput): Promise<Contradiction>;
  getContradiction(id: string): Promise<Contradiction | undefined>;
  listContradictions(opts?: { onlyOpen?: boolean }): Promise<Contradiction[]>;
  contradictionsOf(claimId: string): Promise<Contradiction[]>;
  updateContradiction(
    id: string,
    patch: Partial<Omit<Contradiction, "id" | "projectId" | "a" | "b" | "detectedAt">>,
  ): Promise<Contradiction | undefined>;

  findSimilar(probe: string, limit?: number): Promise<Claim[]>;
}

/**
 * Wrap a sync in-memory `ClaimGraph` in the async interface. Useful for tests
 * that want to exercise code paths written against `AsyncClaimGraph` without
 * spinning up Firestore.
 *
 * When an `embedder` is supplied:
 *   • `addClaim` computes & stores the inline embedding before the underlying
 *     sync graph receives the input — keeps the sync impl free of network IO.
 *   • `findSimilar` embeds the probe and forwards the vector via the sync
 *     graph's `opts.probeEmbedding` channel.
 */
export interface AsAsyncClaimGraphOptions {
  embedder?: Embedder;
}

export function asAsyncClaimGraph(
  sync: ClaimGraph,
  opts: AsAsyncClaimGraphOptions = {},
): AsyncClaimGraph {
  const { embedder } = opts;
  return {
    projectId: sync.projectId,
    async addClaim(input) {
      // If an embedder is wired AND the caller didn't already attach an
      // embedding, compute one now. This keeps the sync graph deterministic:
      // either every claim has a vector (embedder wired) or none do.
      if (embedder && !input.embedding) {
        const e = await embedder.embed(input.atomicAssertion);
        return sync.addClaim({ ...input, embedding: e });
      }
      return sync.addClaim(input);
    },
    async getClaim(id) { return sync.getClaim(id); },
    async getByHash(hash) { return sync.getByHash(hash); },
    async listClaims(opts) { return sync.listClaims(opts); },
    async listByTopic(topicId) { return sync.listByTopic(topicId); },
    async listByEntity(entityId) { return sync.listByEntity(entityId); },
    async updateClaim(id, patch) { return sync.updateClaim(id, patch); },
    async retireClaim(id) { return sync.retireClaim(id); },
    async supersede(oldId, newId) { return sync.supersede(oldId, newId); },
    async addLink(input) { return sync.addLink(input); },
    async linksFrom(id) { return sync.linksFrom(id); },
    async linksTo(id) { return sync.linksTo(id); },
    async addContradiction(input) { return sync.addContradiction(input); },
    async getContradiction(id) { return sync.getContradiction(id); },
    async listContradictions(opts) { return sync.listContradictions(opts); },
    async contradictionsOf(claimId) { return sync.contradictionsOf(claimId); },
    async updateContradiction(id, patch) { return sync.updateContradiction(id, patch); },
    async findSimilar(probe, limit) {
      if (embedder) {
        const probeEmbedding = await embedder.embed(probe);
        return sync.findSimilar(probe, limit, { probeEmbedding: probeEmbedding.vector });
      }
      return sync.findSimilar(probe, limit);
    },
  };
}

/**
 * Convenience: wrap a fresh in-memory graph. Same signature as
 * `createInMemoryClaimGraph` but returns the async shape.
 */
export function createInMemoryAsyncClaimGraph(
  projectId: string,
  opts: AsAsyncClaimGraphOptions = {},
): AsyncClaimGraph {
  return asAsyncClaimGraph(createInMemoryClaimGraph(projectId), opts);
}
