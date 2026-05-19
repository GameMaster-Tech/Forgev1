/**
 * Colour assignment — deterministic, uid-hashed, stable across reloads.
 *
 * `hash(uid) % 8` indexes into the cursor palette. Same uid → same
 * colour everywhere.
 */

import { CURSOR_PALETTE, CURSOR_PALETTE_SOFT } from "./types";

/* ───────────── public API ───────────── */

export function paletteIndexFor(uid: string): number {
  return Math.abs(djb2(uid)) % CURSOR_PALETTE.length;
}

export function colourHexFor(uid: string): string {
  return CURSOR_PALETTE[paletteIndexFor(uid)];
}

export function colourSoftFor(uid: string): string {
  return CURSOR_PALETTE_SOFT[paletteIndexFor(uid)];
}

export function initialsFor(displayName: string): string {
  if (!displayName) return "?";
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + last).toUpperCase().slice(0, 2);
}

/* ───────────── hash ───────────── */

/** djb2 — fast, stable, no crypto needs. */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h * 33) ^ s.charCodeAt(i)) | 0;
  }
  return h;
}
