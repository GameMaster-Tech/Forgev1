/**
 * Rejection bookkeeping for Pulse refactor proposals.
 *
 * Pulse may re-propose the same refactor on every cadence run. When the
 * user explicitly rejects one, we record that decision so the same
 * (block, trigger set) combination is suppressed for a cooldown period
 * (default 7 days). Both the API route and the in-page UI use the same
 * key formula so client-side and server-side state stay aligned.
 */

import type { RefactorProposal } from "./types";

export const REJECTION_TTL_DAYS = 7;
export const REJECTION_TTL_MS = REJECTION_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Stable rejection key. Trigger ids are normalized to a sorted, comma-
 * joined string so order doesn't matter and re-runs converge.
 */
export function rejectionKey(blockId: string, triggeredBy: readonly string[]): string {
  const sorted = [...triggeredBy].map((s) => s.trim()).filter(Boolean).sort();
  return `${blockId}__${sorted.join(",")}`;
}

/** Convenience helper — derives a rejection key straight from a proposal. */
export function rejectionKeyOf(p: RefactorProposal): string {
  return rejectionKey(p.blockId, p.triggeredBy);
}

/**
 * Remove every proposal whose key still has an unexpired rejection
 * entry. Mutates nothing.
 */
export function filterRejected(
  proposals: RefactorProposal[],
  rejected: ReadonlyMap<string, number>,
  now: number = Date.now(),
): RefactorProposal[] {
  if (rejected.size === 0) return proposals;
  return proposals.filter((p) => {
    const exp = rejected.get(rejectionKeyOf(p));
    return !exp || exp < now;
  });
}

/** Prune expired entries from a rejection map. Returns a fresh map. */
export function pruneRejections(
  rejected: ReadonlyMap<string, number>,
  now: number = Date.now(),
): Map<string, number> {
  const next = new Map<string, number>();
  for (const [k, exp] of rejected) {
    if (exp > now) next.set(k, exp);
  }
  return next;
}
