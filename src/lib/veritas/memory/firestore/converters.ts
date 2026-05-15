/**
 * Firestore <-> domain converters for Veritas memory entities.
 *
 * Firestore stores extra rule-enforcement fields (`ownerId`) on every doc
 * that the pure domain types don't declare. These converters centralise the
 * injection / stripping so the rest of the adapter code doesn't leak
 * Firestore-specific shape.
 *
 * Undefined-field discipline
 * ──────────────────────────
 * Firestore rejects writes containing `undefined` values (vs. `null` or
 * missing keys). The domain types are full of optional fields, so we scrub
 * `undefined` from every doc before writing. We preserve `null` and empty
 * arrays/objects since those carry meaning.
 */

import type {
  Claim,
  ClaimLink,
  Contradiction,
  Episode,
} from "../schema";

/** Denormalised-on-write rule field. Never surfaced back to domain types. */
export interface OwnerField {
  ownerId: string;
}

/**
 * Deep-strip `undefined` values — Firestore rejects them. `null`, empty
 * arrays, and empty objects are preserved (they carry meaning).
 */
export function stripUndefined<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefined(v)) as unknown as T;
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

/* ─────────────────────────────────────────────────────────────
 *  Claim
 * ──────────────────────────────────────────────────────────── */

export function claimToDoc(claim: Claim, ownerId: string): Claim & OwnerField {
  return stripUndefined({ ...claim, ownerId });
}

export function docToClaim(data: unknown): Claim {
  const obj = data as Record<string, unknown>;
  // Strip ownerId — not part of the domain type.
  const rest = { ...obj };
  delete rest.ownerId;
  return rest as unknown as Claim;
}

/* ─────────────────────────────────────────────────────────────
 *  ClaimLink
 * ──────────────────────────────────────────────────────────── */

export function linkToDoc(
  link: ClaimLink,
  ownerId: string,
): ClaimLink & OwnerField {
  return stripUndefined({ ...link, ownerId });
}

export function docToLink(data: unknown): ClaimLink {
  const obj = data as Record<string, unknown>;
  const rest = { ...obj };
  delete rest.ownerId;
  return rest as unknown as ClaimLink;
}

/* ─────────────────────────────────────────────────────────────
 *  Contradiction
 * ──────────────────────────────────────────────────────────── */

export function contradictionToDoc(
  c: Contradiction,
  ownerId: string,
): Contradiction & OwnerField {
  return stripUndefined({ ...c, ownerId });
}

export function docToContradiction(data: unknown): Contradiction {
  const obj = data as Record<string, unknown>;
  const rest = { ...obj };
  delete rest.ownerId;
  return rest as unknown as Contradiction;
}

/* ─────────────────────────────────────────────────────────────
 *  Episode
 * ──────────────────────────────────────────────────────────── */

export function episodeToDoc(
  ep: Episode,
  ownerId: string,
): Episode & OwnerField {
  return stripUndefined({ ...ep, ownerId });
}

export function docToEpisode(data: unknown): Episode {
  const obj = data as Record<string, unknown>;
  const rest = { ...obj };
  delete rest.ownerId;
  return rest as unknown as Episode;
}
