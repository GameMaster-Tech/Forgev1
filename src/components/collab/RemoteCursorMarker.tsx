"use client";

/**
 * RemoteCursorMarker — CSS-in-JS shim that injects style rules for
 * remote cursors inside TipTap.
 *
 * The TipTap CollaborationCursor extension renders each remote selection
 * as a span with class `ProseMirror-yjs-cursor` plus `data-user-color`
 * inline style. We pair that with a small label so users can read who
 * is editing. The styling lives in `src/app/globals.css` (search for
 * "Collaboration cursors") for predictable cascading.
 *
 * This component is a render-prop that simply yields nothing — the
 * styles are global. We export the helper anyway so callers have a
 * single import path.
 */

export function RemoteCursorMarker(): null {
  return null;
}
