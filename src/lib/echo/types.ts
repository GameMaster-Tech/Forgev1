/**
 * Echo — the proactive tension surface.
 *
 * Echo watches the user's workspace (docs, calendar, tasks, goals)
 * and speaks up FIRST when something doesn't add up. Each "notice"
 * is a short headline + body + structured action buttons, persisted
 * to Firestore so the user can snooze, dismiss, or jump straight
 * to the source.
 *
 * This file is the shared type surface — safe to import from
 * server, client, or tests.
 */

export type EchoSeverity = "low" | "medium" | "high";

export type EchoKind =
  /** Two documents disagree on a fact / number / date. */
  | "doc_contradiction"
  /** A doc contains time-sensitive prose that's likely stale now. */
  | "doc_freshness"
  /** A goal hasn't been touched in N days. */
  | "goal_drift"
  /** Calendar reality doesn't match a stated plan / commitment. */
  | "calendar_misalignment"
  /** User has scheduled more than their typical capacity for a window. */
  | "capacity_overload"
  /** User committed to X in writing but there's no follow-through artifact. */
  | "missing_followthrough"
  /** Catch-all — model surfaced something the schema doesn't fully cover. */
  | "other";

/** Reference back to the workspace object that triggered the notice. */
export interface EchoSourceRef {
  kind: "doc" | "event" | "task" | "goal";
  id: string;
  /** Short human label so the UI doesn't need to re-fetch to render. */
  label?: string;
  /** Optional project scope so jump-links know where to land. */
  projectId?: string;
}

/** What the user can do with a notice — surfaced as buttons. */
export interface EchoAction {
  /** Stable identifier used by the UI dispatcher. */
  kind: "jump_doc" | "jump_event" | "snooze" | "dismiss" | "mark_done";
  label: string;
  /** Free-form payload — typically `{ docId }` / `{ eventId }` / `{ hours }`. */
  payload?: Record<string, unknown>;
}

/** Resolution after the user acts. */
export type EchoResolution = "fixed" | "snoozed" | "dismissed" | null;

/** Firestore row at `users/{uid}/echo_notices/{noticeId}`. */
export interface EchoNotice {
  /** Document id — same as `signalHash` so dedup is path-level. */
  id: string;
  userId: string;
  projectId: string | null;

  kind: EchoKind;
  severity: EchoSeverity;
  title: string;
  body: string;
  sourceRefs: EchoSourceRef[];
  actions: EchoAction[];

  /** Stable hash over (kind + sources + normalized title). Acts as the
   * Firestore doc id so the same finding is never written twice. */
  signalHash: string;

  /** Millis epoch — set on first surface. */
  createdAt: number;

  /** True once the user has opened the tray after this notice landed. */
  seen: boolean;

  /** Millis epoch the user wants to be re-notified after, or null. */
  snoozedUntil: number | null;

  /** Millis epoch when the user dismissed. Null = active. */
  dismissedAt: number | null;

  /** How the user resolved it (for analytics, never user-facing). */
  resolvedAs: EchoResolution;
}

/** What the scan endpoint returns to the client. */
export interface EchoScanSummary {
  scannedAt: number;
  newNoticesCreated: number;
  activeNoticesAfter: number;
  /** How many seconds of work the model saved vs. doing nothing. */
  groqDurationMs: number;
  /** Set when the scan was throttled (last run was too recent). */
  throttled?: boolean;
  /** Set when the upstream Groq call failed. */
  error?: string;
}
