/**
 * Real-time collaboration — types.
 *
 * Forge's collab layer uses Yjs CRDTs for conflict-free merge and the
 * y-protocols Awareness channel for ephemeral presence (cursors,
 * online state, "X is editing"). Persistence is via a custom
 * Firestore provider; transport is via the existing SSE realtime bus
 * (`/api/realtime/calendar`).
 *
 * This file is pure types — no runtime deps beyond yjs type imports.
 */

import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";

/* ───────────── document identity ───────────── */

/**
 * Forge tracks four document classes; each user keeps a Y.Doc per
 * (class, id) pair. Multiple users editing the same (class, id) see
 * each other.
 */
export type CollabDocKind = "editor" | "lattice-tree" | "sync-graph" | "pulse-blocks";

export interface CollabDocId {
  kind: CollabDocKind;
  /** Project id this doc lives under. */
  projectId: string;
  /** Resource id within the project (document id, root task id, etc.). */
  resourceId: string;
}

/* ───────────── awareness shape ───────────── */

/**
 * Per-tab presence payload. Stamped onto Yjs `Awareness` so every
 * connected peer sees it without polling. The full shape is
 * deliberately small — Awareness is gossiped over the wire and
 * grows quadratically with peer count if abused.
 */
export interface PresenceState {
  /** Stable id for this peer/tab pair. */
  peerId: string;
  /** Authed user id. */
  uid: string;
  /** Display name shown in chips/cursors. */
  displayName: string;
  /** Single-letter avatar fallback. */
  initials: string;
  /** Cursor colour token (index 0–7 into the cursor palette). */
  colourIndex: number;
  /** Resolved hex — convenience, also persisted by the colour resolver. */
  colourHex: string;
  /** What this peer is currently doing. `null` between activities. */
  activity?: PresenceActivity;
  /**
   * Cursor position in the active doc. Either a ProseMirror absolute
   * position (number) for the editor, or { x, y, z } screen coords for
   * canvas-style surfaces (Lattice/Sync). `null` when no cursor.
   */
  cursor?: CursorPayload | null;
  /** Last-active wall-clock from the peer's perspective. */
  lastActiveAt: number;
}

export type PresenceActivity =
  | { type: "viewing" }
  | { type: "typing"; in: "title" | "body" | "field" }
  | { type: "dragging" }
  | { type: "idle" };

export type CursorPayload =
  | { type: "pm"; anchor: number; head: number }   // ProseMirror selection
  | { type: "screen"; x: number; y: number };       // Canvas coords

/* ───────────── controller (returned from useCollab) ───────────── */

export interface CollabController {
  doc: Y.Doc;
  awareness: Awareness;
  /** All currently-connected peers excluding self. */
  peers: PresenceState[];
  /** Local presence — only the fields we control. */
  setActivity(activity: PresenceActivity): void;
  setCursor(cursor: CursorPayload | null): void;
  /** Pretty-printed connection state for the LiveBadge. */
  status: CollabStatus;
  /** Disconnect + dispose. Idempotent. */
  dispose(): void;
}

export type CollabStatus =
  | "idle"        // not yet connected (SSR-safe initial)
  | "connecting"
  | "connected"
  | "syncing"     // actively reconciling
  | "offline"
  | "error";

/* ───────────── provider contract ───────────── */

/**
 * The provider is the gateway between a Y.Doc and the persistence /
 * transport backend. Forge ships one Firestore-backed provider; tests
 * use a no-op in-memory implementation.
 */
export interface CollabProvider {
  /** Become connected to the underlying transport. Idempotent. */
  connect(): Promise<void>;
  /** Tear down listeners + flush pending writes. */
  disconnect(): Promise<void>;
  /** True if writes are flowing. */
  isConnected(): boolean;
  /** Subscribe to status updates. Returns an unsubscriber. */
  onStatus(cb: (s: CollabStatus) => void): () => void;
}

/* ───────────── colour palette ───────────── */

/**
 * Eight-token cursor colour palette (5 brand accents + 3 tonally
 * adjacent extensions). Indexed by `hash(uid) % 8`.
 *
 * Order matters: must stay stable so the same uid always lands on
 * the same colour across page loads and devices.
 *
 * Stored as literal hex (not `var(--...)`) because SVG `fill` does
 * NOT resolve CSS variables on attribute syntax — these go into
 * `<path fill={colourHex}>` directly in CursorOverlay.tsx.
 */
export const CURSOR_PALETTE: readonly string[] = [
  "#2563EB",   // violet (light-mode token)
  "#06B6D4",   // cyan
  "#F97316",   // warm
  "#F43F5E",   // rose
  "#10B981",   // green
  "#8B5CF6",   // violet-deep
  "#14B8A6",   // teal
  "#EAB308",   // amber
] as const;

/** Lighter swatch used for hover backgrounds + selection overlays. */
export const CURSOR_PALETTE_SOFT: readonly string[] = [
  "rgba(37, 99, 235, 0.14)",   // violet
  "rgba(6, 182, 212, 0.14)",
  "rgba(249, 115, 22, 0.14)",
  "rgba(244, 63, 94, 0.14)",
  "rgba(16, 185, 129, 0.14)",
  "rgba(139, 92, 246, 0.14)",
  "rgba(20, 184, 166, 0.14)",
  "rgba(234, 179, 8, 0.16)",
] as const;
