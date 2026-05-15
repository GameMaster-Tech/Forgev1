/**
 * Claim Graph — in-memory implementation (schema v2).
 *
 * This is the reference implementation. In production the same interface is
 * backed by Firestore (entity store) + pgvector/Qdrant (semantic recall).
 *
 * Keeping an in-memory impl lets us:
 *   • unit-test contradiction detection without IO
 *   • run ForgeBench offline
 *   • power browser-side dev without credentials
 *
 * Indices maintained:
 *   byId           Map<claimId, Claim>
 *   byHash         Map<canonicalHash, claimId[]>         // O(1) dedup
 *   byTopic        Map<topicId, Set<claimId>>
 *   byEntity       Map<entityId, Set<claimId>>
 *   linksFromIdx   Map<claimId, Set<linkId>>
 *   linksToIdx     Map<claimId, Set<linkId>>
 */

import type {
  Claim,
  ClaimLink,
  Contradiction,
} from "./schema";
import {
  newClaimId,
  newClaimLinkId,
  newContradictionId,
  canonicalHash,
  isoNow,
} from "./ids";
import { cosine } from "./embeddings/embedder";

/* ─────────────────────────────────────────────────────────────
 *  Input shapes
 * ──────────────────────────────────────────────────────────── */

/** Every field that callers must provide when creating a claim. */
export type NewClaimInput = Omit<
  Claim,
  | "id"
  | "canonicalHash"
  | "contradicts"
  | "supersedes"
  | "supersededBy"
  | "retired"
  | "createdAt"
  | "updatedAt"
>;

export type NewClaimLinkInput = Omit<ClaimLink, "id" | "createdAt">;

export type NewContradictionInput = Omit<
  Contradiction,
  "id" | "detectedAt" | "updatedAt"
>;

/* ─────────────────────────────────────────────────────────────
 *  Interface
 * ──────────────────────────────────────────────────────────── */

export interface ClaimGraph {
  readonly projectId: string;

  /** Add a claim. Deduplicates on canonicalHash — returns the existing claim
   *  if one is already present for this project. */
  addClaim(input: NewClaimInput): Claim;

  getClaim(id: string): Claim | undefined;
  getByHash(hash: string): Claim | undefined;

  listClaims(opts?: { includeRetired?: boolean }): Claim[];
  listByTopic(topicId: string): Claim[];
  listByEntity(entityId: string): Claim[];

  updateClaim(
    id: string,
    patch: Partial<Omit<Claim, "id" | "projectId" | "canonicalHash">>,
  ): Claim | undefined;

  /** Retire a claim (soft-delete) — retains it for audit. */
  retireClaim(id: string): void;

  /** Mark one claim as superseded by another. Updates both endpoints. */
  supersede(oldId: string, newId: string): void;

  addLink(input: NewClaimLinkInput): ClaimLink;
  linksFrom(id: string): ClaimLink[];
  linksTo(id: string): ClaimLink[];

  addContradiction(input: NewContradictionInput): Contradiction;
  getContradiction(id: string): Contradiction | undefined;
  listContradictions(opts?: { onlyOpen?: boolean }): Contradiction[];
  contradictionsOf(claimId: string): Contradiction[];
  updateContradiction(
    id: string,
    patch: Partial<Omit<Contradiction, "id" | "projectId" | "a" | "b" | "detectedAt">>,
  ): Contradiction | undefined;

  /**
   * Similarity search.
   *
   * Two ranking modes:
   *   • Lexical Jaccard (default) — used when no `probeEmbedding` is passed,
   *     same baseline shipped in Phase 1.
   *   • Cosine over stored vectors — when `opts.probeEmbedding` is provided
   *     AND a claim has its `embedding` field populated, that pair scores via
   *     L2-normalised dot product; claims without stored embeddings fall back
   *     to Jaccard so the result list is never empty just because vectors are
   *     missing.
   *
   * The semantic mode is sync because it accepts a precomputed probe vector —
   * the caller is responsible for running its `Embedder.embed(probe)` before
   * the call. This keeps the sync graph blocking-free; the async variants
   * (`AsyncClaimGraph`) take the embedder directly and handle it for you.
   */
  findSimilar(
    probe: string,
    limit?: number,
    opts?: { probeEmbedding?: number[] },
  ): Claim[];
}

/* ─────────────────────────────────────────────────────────────
 *  Implementation
 * ──────────────────────────────────────────────────────────── */

export function createInMemoryClaimGraph(projectId: string): ClaimGraph {
  const byId = new Map<string, Claim>();
  const byHash = new Map<string, string>();           // hash → claim id
  const byTopic = new Map<string, Set<string>>();
  const byEntity = new Map<string, Set<string>>();
  const links = new Map<string, ClaimLink>();
  const linksFromIdx = new Map<string, Set<string>>();
  const linksToIdx = new Map<string, Set<string>>();
  const contradictions = new Map<string, Contradiction>();
  const contradictionsByClaim = new Map<string, Set<string>>();
  /** `canonical(a,b,detector)` → contradiction id. Prevents duplicates. */
  const contradictionPairIndex = new Map<string, string>();

  const addToSetIdx = (m: Map<string, Set<string>>, key: string, val: string) => {
    let s = m.get(key);
    if (!s) {
      s = new Set();
      m.set(key, s);
    }
    s.add(val);
  };

  const indexClaim = (claim: Claim) => {
    byHash.set(claim.canonicalHash, claim.id);
    if (claim.topicId) addToSetIdx(byTopic, claim.topicId, claim.id);
    for (const e of claim.entities) addToSetIdx(byEntity, e, claim.id);
  };

  const unindexClaim = (claim: Claim) => {
    byHash.delete(claim.canonicalHash);
    if (claim.topicId) byTopic.get(claim.topicId)?.delete(claim.id);
    for (const e of claim.entities) byEntity.get(e)?.delete(claim.id);
  };

  return {
    projectId,

    addClaim(input) {
      const hash = canonicalHash(input.atomicAssertion);
      const existingId = byHash.get(hash);
      if (existingId) {
        const existing = byId.get(existingId);
        if (existing) return existing;
      }

      const now = isoNow();
      const claim: Claim = {
        ...input,
        id: newClaimId(),
        projectId,
        canonicalHash: hash,
        contradicts: [],
        supersedes: [],
        retired: false,
        createdAt: now,
        updatedAt: now,
      };
      byId.set(claim.id, claim);
      indexClaim(claim);
      return claim;
    },

    getClaim(id) {
      return byId.get(id);
    },

    getByHash(hash) {
      const id = byHash.get(hash);
      return id ? byId.get(id) : undefined;
    },

    listClaims(opts = {}) {
      const out: Claim[] = [];
      for (const c of byId.values()) {
        if (!opts.includeRetired && c.retired) continue;
        out.push(c);
      }
      return out;
    },

    listByTopic(topicId) {
      const ids = byTopic.get(topicId);
      if (!ids) return [];
      const out: Claim[] = [];
      for (const id of ids) {
        const c = byId.get(id);
        if (c && !c.retired) out.push(c);
      }
      return out;
    },

    listByEntity(entityId) {
      const ids = byEntity.get(entityId);
      if (!ids) return [];
      const out: Claim[] = [];
      for (const id of ids) {
        const c = byId.get(id);
        if (c && !c.retired) out.push(c);
      }
      return out;
    },

    updateClaim(id, patch) {
      const current = byId.get(id);
      if (!current) return undefined;

      // Re-index if topic / entities changed.
      unindexClaim(current);
      const next: Claim = {
        ...current,
        ...patch,
        id: current.id,
        projectId: current.projectId,
        canonicalHash: current.canonicalHash,
        updatedAt: isoNow(),
      };
      // If the caller patched `entityRefs`, keep the denormalised `entities`
      // list in sync so read paths that ignore role (listByEntity) still work.
      // We only auto-sync if the caller did NOT explicitly pass `entities` in
      // the same patch — that's treated as an explicit override.
      if (patch.entityRefs !== undefined && patch.entities === undefined) {
        next.entities = Array.from(new Set(next.entityRefs!.map((r) => r.entityId)));
      }
      byId.set(id, next);
      indexClaim(next);
      return next;
    },

    retireClaim(id) {
      const current = byId.get(id);
      if (!current) return;
      const now = isoNow();
      byId.set(id, { ...current, retired: true, updatedAt: now });
      // Retire cascade — any claim derived from this one must be re-verified
      // because its evidentiary base just changed. We only flip the flag; we
      // do NOT auto-retire descendants, because the user may decide the
      // child still holds on its own merits. The UI surfaces `needsReview`
      // and asks for an explicit decision.
      cascadeNeedsReview(byId, id, now);
    },

    supersede(oldId, newId) {
      // Self-supersede is meaningless and would retire a live claim in place.
      if (oldId === newId) return;
      const oldClaim = byId.get(oldId);
      const newClaim = byId.get(newId);
      if (!oldClaim || !newClaim) return;
      const now = isoNow();
      byId.set(oldId, { ...oldClaim, supersededBy: newId, retired: true, updatedAt: now });
      byId.set(newId, {
        ...newClaim,
        supersedes: newClaim.supersedes.includes(oldId)
          ? newClaim.supersedes
          : [...newClaim.supersedes, oldId],
        updatedAt: now,
      });
      // Supersede is a stronger form of retire — descendants of the OLD claim
      // need review for the same reason. The replacement (`newId`) is healthy,
      // so we do NOT cascade off it.
      cascadeNeedsReview(byId, oldId, now);
    },

    addLink(input) {
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
      links.set(link.id, link);
      addToSetIdx(linksFromIdx, link.from, link.id);
      addToSetIdx(linksToIdx, link.to, link.id);
      return link;
    },

    linksFrom(id) {
      const ids = linksFromIdx.get(id);
      if (!ids) return [];
      return Array.from(ids).map((lid) => links.get(lid)).filter(Boolean) as ClaimLink[];
    },

    linksTo(id) {
      const ids = linksToIdx.get(id);
      if (!ids) return [];
      return Array.from(ids).map((lid) => links.get(lid)).filter(Boolean) as ClaimLink[];
    },

    addContradiction(input) {
      // Refuse self-contradictions — they're always noise.
      if (input.a === input.b) {
        throw new Error(`addContradiction: a and b must differ (${input.a})`);
      }
      // Refuse dangling references — a contradiction that points to
      // nonexistent claims corrupts the denormalised contradicts[] lists.
      const ca0 = byId.get(input.a);
      const cb0 = byId.get(input.b);
      if (!ca0) throw new Error(`addContradiction: unknown claim a=${input.a}`);
      if (!cb0) throw new Error(`addContradiction: unknown claim b=${input.b}`);

      // Dedup on (a,b,detector) — if a contradiction already exists for this
      // unordered pair + detector, return it instead of adding a duplicate.
      const pairKey = canonicalPairKey(input.a, input.b, input.detector);
      const existingId = contradictionPairIndex.get(pairKey);
      if (existingId) {
        const existing = contradictions.get(existingId);
        if (existing) return existing;
      }

      const now = isoNow();
      // Canonicalise ordering so (a,b) == (b,a) at the persistence layer.
      const [a, b] = input.a < input.b ? [input.a, input.b] : [input.b, input.a];
      const c: Contradiction = {
        ...input,
        a,
        b,
        id: newContradictionId(),
        projectId,
        score: clamp01(input.score),
        detectedAt: now,
        updatedAt: now,
      };
      contradictions.set(c.id, c);
      contradictionPairIndex.set(pairKey, c.id);
      addToSetIdx(contradictionsByClaim, c.a, c.id);
      addToSetIdx(contradictionsByClaim, c.b, c.id);

      // Denormalise the pairing onto each claim for fast reads. We only
      // denormalise for OPEN contradictions — once dismissed/resolved the
      // claim-level `contradicts[]` no longer reflects an active conflict.
      if (c.status === "open") {
        const ca = byId.get(c.a);
        const cb = byId.get(c.b);
        if (ca && !ca.contradicts.includes(c.b)) {
          byId.set(ca.id, {
            ...ca,
            contradicts: [...ca.contradicts, c.b],
            updatedAt: now,
          });
        }
        if (cb && !cb.contradicts.includes(c.a)) {
          byId.set(cb.id, {
            ...cb,
            contradicts: [...cb.contradicts, c.a],
            updatedAt: now,
          });
        }
      }
      return c;
    },

    getContradiction(id) {
      return contradictions.get(id);
    },

    listContradictions(opts = {}) {
      const all = Array.from(contradictions.values());
      return opts.onlyOpen ? all.filter((c) => c.status === "open") : all;
    },

    contradictionsOf(claimId) {
      const ids = contradictionsByClaim.get(claimId);
      if (!ids) return [];
      return Array.from(ids)
        .map((id) => contradictions.get(id))
        .filter((c): c is Contradiction => Boolean(c));
    },

    updateContradiction(id, patch) {
      const current = contradictions.get(id);
      if (!current) return undefined;
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
        statusHistory: statusChanged ? statusHistory : (patch.statusHistory ?? current.statusHistory),
        updatedAt: now,
      };
      contradictions.set(id, next);

      // Sync denormalised `contradicts[]` on the two claims when status
      // transitions out of / into `open`. A contradiction that has been
      // dismissed or resolved is no longer an ACTIVE conflict, so the
      // claim-level shortcut must reflect that.
      if (statusChanged) {
        const movedOutOfOpen = current.status === "open" && next.status !== "open";
        const movedIntoOpen = current.status !== "open" && next.status === "open";

        if (movedOutOfOpen) {
          removeFromContradictsDenorm(byId, next.a, next.b, now);
          removeFromContradictsDenorm(byId, next.b, next.a, now);
        } else if (movedIntoOpen) {
          addToContradictsDenorm(byId, next.a, next.b, now);
          addToContradictsDenorm(byId, next.b, next.a, now);
        }
      }
      return next;
    },

    findSimilar(probe, limit = 5, opts = {}) {
      const probeVec = opts.probeEmbedding;
      const tokens = tokenise(probe);
      // If we have neither a vector nor probe tokens, no signal to rank on.
      if (!probeVec && tokens.length === 0) return [];

      const scored: { claim: Claim; score: number }[] = [];
      for (const claim of byId.values()) {
        if (claim.retired) continue;

        // Cosine path — use it whenever both sides have vectors, regardless
        // of probe-token presence. Vectors carry the strongest signal.
        if (probeVec && claim.embedding && claim.embedding.dim === probeVec.length) {
          const sim = cosine(probeVec, claim.embedding.vector);
          // Skip negatives — claims pointing the opposite way semantically.
          if (sim > 0) scored.push({ claim, score: sim });
          continue;
        }

        // Lexical fallback — used when either side lacks a vector. Multiplied
        // by 0.5 so cosine matches always rank above pure-lexical matches when
        // both are present in the same result set; this avoids "the claim
        // without an embedding leapfrogged the perfectly-matched embedded one".
        const lex = jaccard(tokens, tokenise(claim.atomicAssertion));
        if (lex > 0) scored.push({ claim, score: probeVec ? lex * 0.5 : lex });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, limit).map((s) => s.claim);
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 *  Helpers
 * ──────────────────────────────────────────────────────────── */

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Canonicalise an unordered (a,b) pair + detector into a single string key,
 * so that `(x,y,heuristic)` and `(y,x,heuristic)` hash to the same slot.
 */
function canonicalPairKey(a: string, b: string, detector: string): string {
  return a < b ? `${a}|${b}|${detector}` : `${b}|${a}|${detector}`;
}

function addToContradictsDenorm(
  byId: Map<string, Claim>,
  host: string,
  other: string,
  now: string,
): void {
  const c = byId.get(host);
  if (!c) return;
  if (c.contradicts.includes(other)) return;
  byId.set(host, { ...c, contradicts: [...c.contradicts, other], updatedAt: now });
}

/**
 * Retire-cascade: flip `needsReview = true` on every live claim whose
 * `derivation.parentClaimIds` references `parentId`. Single-level only — each
 * descendant retire that follows fires its own cascade, which gives the
 * correct transitive behaviour without recursion (and without surprising the
 * user when they retire one fact and twenty leaves silently flip).
 */
function cascadeNeedsReview(
  byId: Map<string, Claim>,
  parentId: string,
  now: string,
): void {
  for (const c of byId.values()) {
    if (c.retired) continue;
    if (c.needsReview) continue;        // already flagged — idempotent
    const parents = c.derivation?.parentClaimIds;
    if (!parents || parents.length === 0) continue;
    if (!parents.includes(parentId)) continue;
    byId.set(c.id, { ...c, needsReview: true, updatedAt: now });
  }
}

function removeFromContradictsDenorm(
  byId: Map<string, Claim>,
  host: string,
  other: string,
  now: string,
): void {
  const c = byId.get(host);
  if (!c) return;
  if (!c.contradicts.includes(other)) return;
  byId.set(host, {
    ...c,
    contradicts: c.contradicts.filter((x) => x !== other),
    updatedAt: now,
  });
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

/** Exported for tests only. */
export const __internal = { tokenise, jaccard };
