/**
 * FirestoreClaimGraph — production `AsyncClaimGraph` backed by Firestore.
 *
 * Semantics match `createInMemoryClaimGraph` step-for-step. The only
 * differences are:
 *   • every method is Promise-returning (network round-trips)
 *   • every write denormalises `ownerId` for security-rule enforcement
 *   • dedup / pair-dedup / denorm sync is enforced via Firestore transactions
 *     rather than in-process Maps
 *
 * Why denormalise `ownerId` onto every doc?
 * ─────────────────────────────────────────
 * Firestore rules can't cheaply traverse parent projects on every read.
 * Checking `resource.data.ownerId == request.auth.uid` is O(1), whereas
 * `get(/databases/.../projects/$(projectId)).data.userId == ...` adds an
 * extra read per rule evaluation and is rate-limited. We pay one extra
 * byte per doc to keep rules cheap and fast.
 *
 * Why flat root collections, not subcollections under projects/?
 * ──────────────────────────────────────────────────────────────
 *  (a) collectionGroup queries work cleanly if we ever need cross-project
 *      analytics (training-data sampling, admin dashboards)
 *  (b) rules stay flat — one block per collection, no nested match paths
 *  (c) composite indexes are simpler to reason about
 *
 * Phase 2 changes vs Phase 1
 * ──────────────────────────
 *  1. `addClaim` no longer issues `getDocs(query(...))` inside a transaction
 *     (illegal in Firestore SDK — only `tx.get(ref)` is allowed). Instead,
 *     the doc id is now deterministic — `clm-<canonicalHash>` — so dedup
 *     collapses to a single `tx.get(doc(claimsRef, deterministicId))`. Two
 *     concurrent writers of the same assertion both target the same ref;
 *     Firestore's transaction layer serialises them and the second sees the
 *     first's write.
 *  2. `addContradiction` likewise uses a deterministic id (`ctd-<hash(pairKey)>`)
 *     so dedup is real. Phase 1's docstring claimed dedup "scopes to (a,b,
 *     detector) and compares the canonical key client-side" but the lookup
 *     was never actually performed — the bug went undetected because no
 *     callsite raced two contradictions on the same pair yet.
 *  3. Embedder support — when a `VoyageEmbedder` (or any `Embedder`) is wired
 *     at factory time, `addClaim` computes & inlines the vector at write,
 *     and `findSimilar` runs cosine ranking over stored vectors with a
 *     lexical fallback for un-embedded claims.
 *  4. Retire cascade — `retireClaim` and `supersede` now flip
 *     `needsReview = true` on every claim whose `derivation.parentClaimIds`
 *     references the retired one. The cascade query lives outside the
 *     transaction (Firestore prohibits arbitrary queries inside `tx`); the
 *     small race-window between retire and cascade is acceptable for an
 *     audit-surface flag.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  runTransaction,
  writeBatch,
  type Firestore,
  type DocumentData,
  type QueryConstraint,
  type Transaction,
} from "firebase/firestore";

import type {
  Claim,
  ClaimLink,
  Contradiction,
} from "../schema";
import type {
  NewClaimInput,
  NewClaimLinkInput,
  NewContradictionInput,
} from "../claim-graph";
import type { AsyncClaimGraph } from "../async-claim-graph";
import {
  newClaimLinkId,
  canonicalHash,
  isoNow,
  deterministicClaimId,
  deterministicContradictionId,
} from "../ids";
import type { Embedder } from "../embeddings/embedder";
import { hybridSearch } from "../retrieval/hybrid";
import { bm25Cache } from "../retrieval/cache";
import { workspaceCache } from "@/lib/retrieval/cache";
import { VERITAS_COLLECTIONS } from "./collections";
import {
  claimToDoc,
  docToClaim,
  linkToDoc,
  docToLink,
  contradictionToDoc,
  docToContradiction,
} from "./converters";

/* ─────────────────────────────────────────────────────────────
 *  Local helpers
 * ──────────────────────────────────────────────────────────── */

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Canonicalise an unordered (a,b) pair + detector — matches the in-memory
 * impl's key so behaviour is identical.
 */
function canonicalPairKey(a: string, b: string, detector: string): string {
  return a < b ? `${a}|${b}|${detector}` : `${b}|${a}|${detector}`;
}

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "in", "is", "it", "its", "of", "on", "or", "that", "the", "to", "was", "were",
  "with", "this", "these", "those", "we", "our", "their", "they", "them", "but",
]);

function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/* ─────────────────────────────────────────────────────────────
 *  Factory
 * ──────────────────────────────────────────────────────────── */

export interface FirestoreClaimGraphOptions {
  db: Firestore;
  projectId: string;
  /** Owner uid — denormalised onto every write, enforced by security rules. */
  ownerId: string;
  /**
   * Optional embedder. When supplied, `addClaim` embeds `atomicAssertion`
   * before write and `findSimilar` ranks by cosine over the stored vectors.
   * When omitted, similarity falls back to lexical Jaccard (Phase 1 baseline).
   */
  embedder?: Embedder;
}

export function createFirestoreClaimGraph(
  opts: FirestoreClaimGraphOptions,
): AsyncClaimGraph {
  const { db, projectId, ownerId, embedder } = opts;

  // Refs to each collection, scoped tidily.
  const claimsRef = collection(db, VERITAS_COLLECTIONS.claims);
  const linksRef = collection(db, VERITAS_COLLECTIONS.claimLinks);
  const contraRef = collection(db, VERITAS_COLLECTIONS.contradictions);

  const projectFilter = where("projectId", "==", projectId);

  /* ── Internal read helpers ───────────────────────────────── */

  async function runQueryClaims(
    ...constraints: QueryConstraint[]
  ): Promise<Claim[]> {
    const snap = await getDocs(query(claimsRef, projectFilter, ...constraints));
    return snap.docs.map((d) => docToClaim(d.data() as DocumentData));
  }

  async function runQueryLinks(
    ...constraints: QueryConstraint[]
  ): Promise<ClaimLink[]> {
    const snap = await getDocs(query(linksRef, projectFilter, ...constraints));
    return snap.docs.map((d) => docToLink(d.data() as DocumentData));
  }

  async function runQueryContradictions(
    ...constraints: QueryConstraint[]
  ): Promise<Contradiction[]> {
    const snap = await getDocs(query(contraRef, projectFilter, ...constraints));
    return snap.docs.map((d) => docToContradiction(d.data() as DocumentData));
  }

  /**
   * Find descendants whose derivation.parentClaimIds includes `parentId` and
   * flip `needsReview` on each. Runs OUTSIDE any transaction — Firestore
   * disallows arbitrary queries inside `runTransaction`. Best-effort with a
   * small consistency window (see file header).
   */
  async function cascadeNeedsReviewOnDescendants(parentId: string): Promise<void> {
    // Use `array-contains` on the nested field. Index defined in
    // `firestore.indexes.json` under collectionGroup `veritasClaims`.
    const snap = await getDocs(
      query(
        claimsRef,
        projectFilter,
        where("derivation.parentClaimIds", "array-contains", parentId),
      ),
    );
    if (snap.empty) return;
    const now = isoNow();
    const batch = writeBatch(db);
    let writes = 0;
    for (const d of snap.docs) {
      const c = docToClaim(d.data() as DocumentData);
      if (c.retired) continue;
      if (c.needsReview) continue;
      batch.set(
        doc(claimsRef, c.id),
        claimToDoc({ ...c, needsReview: true, updatedAt: now }, ownerId),
      );
      writes++;
      // Firestore caps batches at 500 writes. Defensive flush — claim
      // descendant counts should never approach this in practice.
      if (writes >= 450) {
        await batch.commit();
        writes = 0;
      }
    }
    if (writes > 0) await batch.commit();
  }

  return {
    projectId,

    /* ─────── Claims ─────── */

    async addClaim(input: NewClaimInput): Promise<Claim> {
      const hash = canonicalHash(input.atomicAssertion);
      const id = deterministicClaimId(hash);

      // Embed BEFORE entering the transaction — embedders are network-bound
      // and Firestore transactions must be short-lived. If the same hash
      // already exists we still pay the embed cost on the first write of
      // each new assertion (cost-free thereafter — dedup short-circuits).
      let embedding = input.embedding;
      if (!embedding && embedder) {
        const e = await embedder.embed(input.atomicAssertion);
        embedding = { vector: e.vector, dim: e.dim, modelId: e.modelId };
      }

      // Transaction: deterministic id collapses dedup to a single `tx.get`.
      // No queries inside the tx (Firestore SDK forbids them).
      return runTransaction(db, async (tx) => {
        const ref = doc(claimsRef, id);
        const existing = await tx.get(ref);
        if (existing.exists()) {
          return docToClaim(existing.data() as DocumentData);
        }

        const now = isoNow();
        const claim: Claim = {
          ...input,
          id,
          projectId,
          canonicalHash: hash,
          contradicts: [],
          supersedes: [],
          retired: false,
          createdAt: now,
          updatedAt: now,
          ...(embedding ? { embedding } : {}),
        };
        tx.set(ref, claimToDoc(claim, ownerId));
        return claim;
      }).then((c) => {
        bm25Cache.invalidate(projectId);
        workspaceCache.invalidate(projectId);
        return c;
      });
    },

    async getClaim(id: string): Promise<Claim | undefined> {
      const snap = await getDoc(doc(claimsRef, id));
      if (!snap.exists()) return undefined;
      const data = snap.data() as DocumentData;
      // Sanity: projectId match — prevents cross-tenant leakage if an id is
      // guessed. The security rules also enforce this at the ownerId level.
      if (data.projectId !== projectId) return undefined;
      return docToClaim(data);
    },

    async getByHash(hash: string): Promise<Claim | undefined> {
      // Deterministic id derivation lets us hit the doc directly. Falls back
      // to a query if no matching doc — covers legacy claims persisted under
      // random ids before Phase 2.
      const direct = await getDoc(doc(claimsRef, deterministicClaimId(hash)));
      if (direct.exists()) {
        const data = direct.data() as DocumentData;
        if (data.projectId === projectId) return docToClaim(data);
      }
      const snap = await getDocs(
        query(
          claimsRef,
          projectFilter,
          where("canonicalHash", "==", hash),
          firestoreLimit(1),
        ),
      );
      if (snap.empty) return undefined;
      return docToClaim(snap.docs[0].data() as DocumentData);
    },

    async listClaims(opts: { includeRetired?: boolean } = {}): Promise<Claim[]> {
      if (opts.includeRetired) {
        return runQueryClaims(orderBy("updatedAt", "desc"));
      }
      return runQueryClaims(
        where("retired", "==", false),
        orderBy("updatedAt", "desc"),
      );
    },

    async listByTopic(topicId: string): Promise<Claim[]> {
      return runQueryClaims(
        where("topicId", "==", topicId),
        where("retired", "==", false),
      );
    },

    async listByEntity(entityId: string): Promise<Claim[]> {
      return runQueryClaims(
        where("entities", "array-contains", entityId),
        where("retired", "==", false),
      );
    },

    async updateClaim(id, patch): Promise<Claim | undefined> {
      return runTransaction(db, async (tx) => {
        const ref = doc(claimsRef, id);
        const snap = await tx.get(ref);
        if (!snap.exists()) return undefined;
        const current = docToClaim(snap.data() as DocumentData);
        if (current.projectId !== projectId) return undefined;

        const next: Claim = {
          ...current,
          ...patch,
          id: current.id,
          projectId: current.projectId,
          canonicalHash: current.canonicalHash,
          updatedAt: isoNow(),
        };
        // Mirror the in-memory impl: auto-sync `entities` when caller patched
        // entityRefs without also overriding entities explicitly.
        if (patch.entityRefs !== undefined && patch.entities === undefined) {
          next.entities = Array.from(
            new Set(next.entityRefs!.map((r) => r.entityId)),
          );
        }
        tx.set(ref, claimToDoc(next, ownerId));
        return next;
      }).then((c) => {
        bm25Cache.invalidate(projectId);
        workspaceCache.invalidate(projectId);
        return c;
      });
    },

    async retireClaim(id: string): Promise<void> {
      await runTransaction(db, async (tx) => {
        const ref = doc(claimsRef, id);
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const current = docToClaim(snap.data() as DocumentData);
        if (current.projectId !== projectId) return;
        tx.set(
          ref,
          claimToDoc({ ...current, retired: true, updatedAt: isoNow() }, ownerId),
        );
      });
      // Outside the transaction — see `cascadeNeedsReviewOnDescendants` doc.
      await cascadeNeedsReviewOnDescendants(id);
      bm25Cache.invalidate(projectId);
      workspaceCache.invalidate(projectId);
    },

    async supersede(oldId: string, newId: string): Promise<void> {
      if (oldId === newId) return;
      await runTransaction(db, async (tx) => {
        const oldRef = doc(claimsRef, oldId);
        const newRef = doc(claimsRef, newId);
        const [oldSnap, newSnap] = await Promise.all([
          tx.get(oldRef),
          tx.get(newRef),
        ]);
        if (!oldSnap.exists() || !newSnap.exists()) return;
        const oldClaim = docToClaim(oldSnap.data() as DocumentData);
        const newClaim = docToClaim(newSnap.data() as DocumentData);
        if (oldClaim.projectId !== projectId || newClaim.projectId !== projectId) {
          return;
        }
        const now = isoNow();
        tx.set(
          oldRef,
          claimToDoc(
            { ...oldClaim, supersededBy: newId, retired: true, updatedAt: now },
            ownerId,
          ),
        );
        tx.set(
          newRef,
          claimToDoc(
            {
              ...newClaim,
              supersedes: newClaim.supersedes.includes(oldId)
                ? newClaim.supersedes
                : [...newClaim.supersedes, oldId],
              updatedAt: now,
            },
            ownerId,
          ),
        );
      });
      // Cascade off the OLD claim — descendants of the replacement are healthy.
      await cascadeNeedsReviewOnDescendants(oldId);
      bm25Cache.invalidate(projectId);
      workspaceCache.invalidate(projectId);
    },

    /* ─────── Links ─────── */

    async addLink(input: NewClaimLinkInput): Promise<ClaimLink> {
      const link: ClaimLink = {
        id: newClaimLinkId(),
        projectId,
        from: input.from,
        to: input.to,
        type: input.type,
        strength: clamp01(input.strength),
        rationale: input.rationale,
        createdAt: isoNow(),
      };
      const batch = writeBatch(db);
      batch.set(doc(linksRef, link.id), linkToDoc(link, ownerId));
      await batch.commit();
      return link;
    },

    async linksFrom(id: string): Promise<ClaimLink[]> {
      return runQueryLinks(where("from", "==", id));
    },

    async linksTo(id: string): Promise<ClaimLink[]> {
      return runQueryLinks(where("to", "==", id));
    },

    /* ─────── Contradictions ─────── */

    async addContradiction(input: NewContradictionInput): Promise<Contradiction> {
      if (input.a === input.b) {
        throw new Error(`addContradiction: a and b must differ (${input.a})`);
      }

      const pairKey = canonicalPairKey(input.a, input.b, input.detector);
      const id = deterministicContradictionId(pairKey);

      return runTransaction(db, async (tx) => {
        // Same pattern as addClaim — deterministic id collapses dedup to a
        // single `tx.get`. No outside-transaction "search" that the Phase 1
        // implementation claimed but never actually executed.
        const cdRef = doc(contraRef, id);
        const aRef = doc(claimsRef, input.a);
        const bRef = doc(claimsRef, input.b);

        const [cdSnap, aSnap, bSnap] = await Promise.all([
          tx.get(cdRef),
          tx.get(aRef),
          tx.get(bRef),
        ]);

        if (cdSnap.exists()) {
          return docToContradiction(cdSnap.data() as DocumentData);
        }

        // Both endpoints must exist — refuse dangling references.
        if (!aSnap.exists()) {
          throw new Error(`addContradiction: unknown claim a=${input.a}`);
        }
        if (!bSnap.exists()) {
          throw new Error(`addContradiction: unknown claim b=${input.b}`);
        }
        const aClaim = docToClaim(aSnap.data() as DocumentData);
        const bClaim = docToClaim(bSnap.data() as DocumentData);

        // Canonicalise ordering so (a,b) == (b,a) at the persistence layer.
        const [a, b] = input.a < input.b
          ? [input.a, input.b]
          : [input.b, input.a];

        const now = isoNow();
        const c: Contradiction = {
          ...input,
          a,
          b,
          id,
          projectId,
          score: clamp01(input.score),
          detectedAt: now,
          updatedAt: now,
        };
        tx.set(
          cdRef,
          { ...contradictionToDoc(c, ownerId), pairKey },
        );

        // Denormalise onto each claim for fast reads — only while open.
        if (c.status === "open") {
          if (!aClaim.contradicts.includes(b)) {
            tx.set(
              aRef,
              claimToDoc(
                {
                  ...aClaim,
                  contradicts: [...aClaim.contradicts, b],
                  updatedAt: now,
                },
                ownerId,
              ),
            );
          }
          if (!bClaim.contradicts.includes(a)) {
            tx.set(
              bRef,
              claimToDoc(
                {
                  ...bClaim,
                  contradicts: [...bClaim.contradicts, a],
                  updatedAt: now,
                },
                ownerId,
              ),
            );
          }
        }
        return c;
      });
    },

    async getContradiction(id: string): Promise<Contradiction | undefined> {
      const snap = await getDoc(doc(contraRef, id));
      if (!snap.exists()) return undefined;
      const data = snap.data() as DocumentData;
      if (data.projectId !== projectId) return undefined;
      return docToContradiction(data);
    },

    async listContradictions(
      opts: { onlyOpen?: boolean } = {},
    ): Promise<Contradiction[]> {
      if (opts.onlyOpen) {
        return runQueryContradictions(
          where("status", "==", "open"),
          orderBy("detectedAt", "desc"),
        );
      }
      return runQueryContradictions(orderBy("detectedAt", "desc"));
    },

    async contradictionsOf(claimId: string): Promise<Contradiction[]> {
      // (a,b) is canonicalised so either `a` or `b` may reference this claim.
      // Two parallel queries, then de-dup by id.
      const [asA, asB] = await Promise.all([
        runQueryContradictions(where("a", "==", claimId)),
        runQueryContradictions(where("b", "==", claimId)),
      ]);
      const seen = new Set<string>();
      const out: Contradiction[] = [];
      for (const c of [...asA, ...asB]) {
        if (seen.has(c.id)) continue;
        seen.add(c.id);
        out.push(c);
      }
      return out;
    },

    async updateContradiction(id, patch): Promise<Contradiction | undefined> {
      return runTransaction(db, async (tx) => {
        const ref = doc(contraRef, id);
        const snap = await tx.get(ref);
        if (!snap.exists()) return undefined;
        const current = docToContradiction(snap.data() as DocumentData);
        if (current.projectId !== projectId) return undefined;

        const now = isoNow();
        const statusChanged =
          patch.status !== undefined && patch.status !== current.status;

        const statusHistory = current.statusHistory
          ? [...current.statusHistory]
          : [];
        if (statusChanged) {
          statusHistory.push({
            from: current.status,
            to: patch.status!,
            at: now,
            rationale: patch.resolutionRationale ?? current.resolutionRationale,
          });
        }

        const next: Contradiction = {
          ...current,
          ...patch,
          id: current.id,
          projectId: current.projectId,
          a: current.a,
          b: current.b,
          detectedAt: current.detectedAt,
          statusHistory: statusChanged
            ? statusHistory
            : (patch.statusHistory ?? current.statusHistory),
          updatedAt: now,
        };
        tx.set(ref, contradictionToDoc(next, ownerId));

        // Denorm sync on `contradicts[]` arrays — same semantics as sync impl.
        if (statusChanged) {
          const movedOutOfOpen =
            current.status === "open" && next.status !== "open";
          const movedIntoOpen =
            current.status !== "open" && next.status === "open";
          if (movedOutOfOpen) {
            await syncContradictsDenorm(tx, claimsRef, next.a, next.b, ownerId, projectId, "remove", now);
            await syncContradictsDenorm(tx, claimsRef, next.b, next.a, ownerId, projectId, "remove", now);
          } else if (movedIntoOpen) {
            await syncContradictsDenorm(tx, claimsRef, next.a, next.b, ownerId, projectId, "add", now);
            await syncContradictsDenorm(tx, claimsRef, next.b, next.a, ownerId, projectId, "add", now);
          }
        }
        return next;
      });
    },

    /* ─────── Similarity — hybrid BM25 + cosine rerank ─────────────────── */

    async findSimilar(probe: string, limit = 5): Promise<Claim[]> {
      // Compute the probe embedding before the read so the cache-miss
      // path doesn't double-roundtrip if the index has to be rebuilt.
      let probeVec: number[] | undefined;
      if (embedder) {
        const e = await embedder.embed(probe);
        probeVec = e.vector;
      }

      // Pull every non-retired claim for the project. The BM25 cache
      // means we only do the actual scoring math once per project until
      // the next write invalidates.
      const all = await runQueryClaims(where("retired", "==", false));

      const results = hybridSearch(projectId, probe, all, {
        limit,
        topK: 50,
        probeEmbedding: probeVec,
        cosineWeight: 0.7,
      });
      return results.map((r) => r.claim);
    },
  };
}

/**
 * Sync the denormalised `contradicts[]` array on one claim.
 * Used by `updateContradiction` when a contradiction transitions into/out of
 * the `open` state. Kept outside the returned object so the transaction has
 * direct access to the ref.
 */
async function syncContradictsDenorm(
  tx: Transaction,
  claimsRef: ReturnType<typeof collection>,
  host: string,
  other: string,
  ownerId: string,
  projectId: string,
  op: "add" | "remove",
  now: string,
): Promise<void> {
  const ref = doc(claimsRef, host);
  const snap = await tx.get(ref);
  if (!snap.exists()) return;
  const current = docToClaim(snap.data() as DocumentData);
  if (current.projectId !== projectId) return;

  const has = current.contradicts.includes(other);
  if (op === "add" && has) return;
  if (op === "remove" && !has) return;

  const contradicts =
    op === "add"
      ? [...current.contradicts, other]
      : current.contradicts.filter((x) => x !== other);
  tx.set(
    ref,
    claimToDoc({ ...current, contradicts, updatedAt: now }, ownerId),
  );
}
