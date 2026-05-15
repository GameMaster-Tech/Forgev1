/**
 * Stable id generation + canonicalisation helpers for Veritas memory entities.
 * Prefixes are intentional — grep-friendly and informative in logs.
 */

function rand(len: number): string {
  return Math.random().toString(36).slice(2, 2 + len);
}

function stamp(): string {
  return Date.now().toString(36);
}

export function newClaimId(): string       { return `clm-${stamp()}-${rand(6)}`; }
export function newClaimLinkId(): string   { return `lnk-${stamp()}-${rand(6)}`; }
export function newEpisodeId(): string     { return `epi-${stamp()}-${rand(6)}`; }
export function newEntityId(): string      { return `ent-${stamp()}-${rand(6)}`; }
export function newTopicId(): string       { return `top-${stamp()}-${rand(6)}`; }
export function newContradictionId(): string { return `ctd-${stamp()}-${rand(6)}`; }
export function newSnapshotId(): string    { return `snp-${stamp()}-${rand(6)}`; }

/**
 * Deterministic id derived from a canonical hash. Same hash ⇒ same id, which
 * is the correct primitive for transactional dedup in Firestore: instead of
 * issuing `getDocs(query(... where canonicalHash))` inside a `runTransaction`
 * (which Firestore SDK forbids — only `tx.get(ref)` is allowed), the adapter
 * computes the deterministic doc id up-front and `tx.get(doc(ref, id))` on it.
 *
 * Two-claim-races on the same assertion now collapse on the doc id, not on a
 * post-hoc dedup query.
 */
export function deterministicClaimId(hash: string): string {
  return `clm-${hash}`;
}

/**
 * Deterministic id for a contradiction pair + detector. Same primitive — lets
 * `addContradiction` use `tx.get(ref)` for real dedup instead of a no-op
 * outside-transaction "search" that the docstring claimed but never executed.
 */
export function deterministicContradictionId(pairKey: string): string {
  // Hash the pair key so the doc id stays a fixed length regardless of how
  // long the input claim ids get. Same dual-FNV primitive as `canonicalHash`.
  return `ctd-${canonicalHash(pairKey)}`;
}

/**
 * DOIs contain `/` and `.` — `/` is illegal in Firestore document ids, and
 * `.` / the `/` break path-style routing. We encode by:
 *   - trimming + lowercasing (DOIs are case-insensitive per spec)
 *   - stripping whitespace
 *   - replacing `/` with `_`
 *   - stripping any remaining characters outside [a-z0-9._\-_]
 * The reverse-mapping is not needed at the id level — the canonical DOI is
 * stored in `SourceRef.doi`. Ids are purely for addressing.
 */
export function encodeDoiForId(doi: string): string {
  return doi
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/\//g, "_")
    .replace(/[^a-z0-9._\-]/g, "-");
}

export function newSourceRefId(doi?: string): string {
  if (doi && doi.trim().length > 0) {
    return `src-${encodeDoiForId(doi)}`;
  }
  return `src-${stamp()}-${rand(6)}`;
}

/* ─────────────────────────────────────────────────────────────
 *  ISO timestamps — we prefer these over epoch ms for durable fields
 *  because Firestore's admin UI shows them human-readable.
 * ──────────────────────────────────────────────────────────── */

export function isoNow(): string {
  return new Date().toISOString();
}

/* ─────────────────────────────────────────────────────────────
 *  Canonical hashing — deterministic, dependency-free.
 *  Two FNV-1a 32-bit passes (seeded differently) concatenated to form a
 *  64-bit hex string. Collision-resistant enough for project-level dedup
 *  while staying compatible with ES2017 (no BigInt literals).
 *
 *  The normalisation must stay identical across callers — same input ⇒
 *  same hash across languages and runtimes.
 * ──────────────────────────────────────────────────────────── */

export function canonicaliseText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")                     // collapse diacritics
    .replace(/[\u0300-\u036f]/g, "")       // strip combining marks
    .replace(/[^a-z0-9\s]/g, " ")          // drop punctuation
    .replace(/\s+/g, " ")
    .trim();
}

function fnv1a32(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // Multiply by the 32-bit FNV prime (16777619) using Math.imul for correctness.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function canonicalHash(s: string): string {
  const input = canonicaliseText(s);
  // Two seeded passes — independent enough that concatenation gives us
  // an effective 64-bit hash without BigInt.
  const h1 = fnv1a32(input, 0x811c9dc5);
  const h2 = fnv1a32(input, 0xcbf29ce4);
  return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0");
}
