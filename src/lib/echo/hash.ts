/**
 * Echo — stable signal hash.
 *
 * Used as the Firestore doc id for every notice so dedup is
 * path-level: writing the same finding twice is a no-op.
 *
 * Inputs are normalised before hashing so trivial variations
 * ("Goal: ship by May 12" vs "goal:  ship by may 12") collapse.
 *
 * Algorithm: djb2 → base-36, 12 chars. Fast, deterministic, no deps.
 * Combined with the `kind` prefix and sorted source-ref ids so two
 * different KINDS over the same sources don't collide.
 */

import type { EchoKind, EchoSourceRef } from "./types";

function djb2(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h) ^ input.charCodeAt(i); // h * 33 ^ c
  }
  // Force unsigned 32-bit, encode short.
  return (h >>> 0).toString(36).padStart(7, "0");
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'") // smart → straight quotes
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, "-") // en/em dash → hyphen
    .replace(/[^a-z0-9' "-]/g, " ") // strip everything else
    .replace(/\s+/g, " ")
    .trim();
}

function refKey(r: EchoSourceRef): string {
  return `${r.kind}:${r.id}`;
}

/**
 * Compute the stable signal hash. Two notices that share kind +
 * source ids + normalized title produce the same hash, so the
 * scan never writes a duplicate.
 *
 * Title is included (after normalization) so genuinely different
 * findings on the same sources (e.g. two contradictions between
 * the same two docs) get separate notices instead of one
 * overwriting the other.
 */
export function signalHash(args: {
  kind: EchoKind;
  sourceRefs: EchoSourceRef[];
  title: string;
}): string {
  const sources = [...args.sourceRefs.map(refKey)].sort().join("|");
  const title = normalize(args.title).slice(0, 80);
  const payload = `${args.kind}::${sources}::${title}`;
  return `${args.kind.slice(0, 4)}_${djb2(payload)}`;
}
