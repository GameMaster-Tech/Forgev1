/**
 * Notifications — types.
 *
 * In-app notifications model. Email digests and browser push are
 * captured as future hooks; the in-app surface is sufficient for v1.
 *
 * Each notification has a kind (drives icon + preference key), a
 * severity (drives tone), an at timestamp, a title + summary, and an
 * optional href the bell-panel routes to on click. Read state is
 * tracked per notification.
 */

export type NotificationKind =
  | "sync.conflict"
  | "sync.compiled"
  | "pulse.invalidation"
  | "pulse.refactor.queued"
  | "lattice.rebranch"
  | "tempo.overload"
  | "habit.nudge"
  | "habit.streak.milestone"
  | "sharing.invited"
  | "sharing.revoked"
  | "integration.connected"
  | "integration.error";

export type NotificationSeverity = "info" | "success" | "warn" | "error";

export interface Notification {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  at: number;
  title: string;
  summary: string;
  /** Optional deep-link the bell panel uses. */
  href?: string;
  /** Optional project context. */
  projectId?: string;
  /** Owner. */
  uid?: string;
  /** Whether the user has acknowledged this notification. */
  read: boolean;
  /** Free-form payload. */
  detail?: Record<string, unknown>;
}

/* ───────────── preferences ───────────── */

/**
 * Per-kind opt-in flag. Default true except for the noisy kinds. The
 * UI surfaces a preferences pane that toggles these.
 */
export type NotificationPreferences = Record<NotificationKind, boolean>;

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  "sync.conflict":           true,
  "sync.compiled":           false,   // noisy — opt-in
  "pulse.invalidation":      true,
  "pulse.refactor.queued":   true,
  "lattice.rebranch":        false,   // noisy
  "tempo.overload":          true,
  "habit.nudge":             true,
  "habit.streak.milestone":  true,
  "sharing.invited":         true,
  "sharing.revoked":         true,
  "integration.connected":   true,
  "integration.error":       true,
};

/* ───────────── store contract ───────────── */

export interface NotificationStore {
  list(filter?: { unreadOnly?: boolean; limit?: number }): Notification[];
  push(args: Omit<Notification, "id" | "read" | "at"> & { at?: number }): Notification;
  markRead(id: string): void;
  markAllRead(): void;
  clearAll(): void;
  subscribe(fn: (snapshot: Notification[]) => void): () => void;
  unreadCount(): number;
}
