/**
 * Google Calendar sync layer — bidirectional with conflict resolution.
 *
 * Production setup
 *  ─────────────────
 *   The OAuth token exchange MUST happen server-side. This module
 *   exposes the pure pieces (state machine, diff/merge, retry logic)
 *   so a Next.js Route Handler at `/api/integrations/google/callback`
 *   can wire the token exchange + persist the refresh-token in
 *   Firestore under `users/{uid}/integrations/google`.
 *
 *   See `docs/CALENDAR_SETUP.md` for the full OAuth wiring (client id,
 *   redirect URI, scopes, refresh-token persistence).
 *
 * What this file ships today
 *  ─────────────────────────
 *   • `GoogleSyncStateMachine` — sane state transitions
 *   • `bidirectionalDiff()`   — three-way merge: workspace ↔ remote ↔
 *                               last-known-good
 *   • `resolveSyncConflict()` — last-writer-wins + conflict log
 *   • `backoffSchedule()`     — exponential retry on transient errors
 *
 *   The actual `fetch()` calls live behind a thin `GoogleHttpClient`
 *   interface so tests / mocks / server-side adapters slot in without
 *   touching the merge logic.
 */

import type { TimedEvent } from "./types";

/* ───────────── http boundary ───────────── */

export interface GoogleHttpClient {
  /** Fetch the user's primary calendar events in `[timeMin, timeMax]`. */
  listEvents(args: { accessToken: string; timeMin: string; timeMax: string; pageToken?: string }): Promise<{ events: GoogleEvent[]; nextPageToken?: string }>;
  insertEvent(args: { accessToken: string; calendarId: string; event: GoogleEvent }): Promise<GoogleEvent>;
  patchEvent(args:  { accessToken: string; calendarId: string; eventId: string; patch: Partial<GoogleEvent>; etag?: string }): Promise<GoogleEvent>;
  deleteEvent(args: { accessToken: string; calendarId: string; eventId: string }): Promise<void>;
  /** Token refresh — server-side. */
  refresh(args: { refreshToken: string }): Promise<{ accessToken: string; expiresIn: number }>;
}

export interface GoogleEvent {
  id: string;
  etag?: string;
  summary?: string;
  description?: string;
  location?: string;
  start: { dateTime?: string; date?: string; timeZone?: string };
  end:   { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email?: string; displayName?: string; responseStatus?: "needsAction" | "declined" | "tentative" | "accepted" }[];
  recurrence?: string[];
  status?: "confirmed" | "tentative" | "cancelled";
  updated?: string;
}

/* ───────────── state machine ───────────── */

export type SyncState =
  | "disconnected"
  | "authorizing"
  | "connected.idle"
  | "connected.syncing"
  | "connected.error"
  | "connected.rate-limited"
  | "revoked";

export interface SyncEvent {
  kind:
    | "start.oauth" | "oauth.success" | "oauth.failure"
    | "sync.start" | "sync.success" | "sync.failure"
    | "rate.limited" | "token.expired" | "user.disconnect" | "user.revoked";
  detail?: string;
}

const TRANSITIONS: Record<SyncState, Partial<Record<SyncEvent["kind"], SyncState>>> = {
  "disconnected": {
    "start.oauth": "authorizing",
  },
  "authorizing": {
    "oauth.success": "connected.idle",
    "oauth.failure": "disconnected",
  },
  "connected.idle": {
    "sync.start":      "connected.syncing",
    "user.disconnect": "disconnected",
    "user.revoked":    "revoked",
  },
  "connected.syncing": {
    "sync.success":  "connected.idle",
    "sync.failure":  "connected.error",
    "rate.limited":  "connected.rate-limited",
    "token.expired": "connected.idle",
  },
  "connected.error": {
    "sync.start":      "connected.syncing",
    "user.disconnect": "disconnected",
  },
  "connected.rate-limited": {
    "sync.start":      "connected.syncing",
  },
  "revoked": {
    "start.oauth": "authorizing",
  },
};

export function transition(state: SyncState, event: SyncEvent): SyncState {
  return TRANSITIONS[state][event.kind] ?? state;
}

/* ───────────── retry / backoff ───────────── */

/**
 * Exponential backoff with jitter. Returns the delay in ms for retry
 * attempt `n` (1-based). Maxes out at 5 minutes.
 */
export function backoffSchedule(attempt: number): number {
  const base = Math.min(5 * 60_000, 1000 * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * Math.min(1000, base * 0.2));
  return base + jitter;
}

/* ───────────── three-way diff ───────────── */

/**
 * Compare workspace-side and remote events against the last-known-good
 * snapshot to compute the writes each side needs to apply.
 *
 *   localOnly   — present in workspace, missing remotely  → POST to remote
 *   remoteOnly  — present remotely, missing in workspace → INSERT locally
 *   bothChanged — present on both sides, both edited       → conflict
 *   tombstones  — deleted on one side, present on other    → DELETE the other
 */
export interface BidirectionalDiff {
  toCreateRemote: TimedEvent[];
  toUpdateRemote: { local: TimedEvent; remoteId: string; etag?: string }[];
  toDeleteRemote: { remoteId: string }[];
  toCreateLocal: TimedEvent[];
  toUpdateLocal: { remoteEvent: GoogleEvent; localId: string }[];
  toDeleteLocal: { localId: string }[];
  conflicts: SyncConflict[];
}

export interface SyncSnapshotEntry {
  localId: string;
  remoteId: string;
  remoteEtag?: string;
  /** Hash of the local fields we care about, for fast diffing. */
  localFingerprint: string;
  syncedAt: number;
}

export interface SyncConflict {
  localId: string;
  remoteId: string;
  /** Plain-English description of what diverged. */
  diff: string;
  localUpdatedAt: number;
  remoteUpdatedAt: number;
}

export function bidirectionalDiff(args: {
  local: TimedEvent[];
  remote: GoogleEvent[];
  snapshot: SyncSnapshotEntry[];
}): BidirectionalDiff {
  const byLocalId = new Map(args.local.map((e) => [e.id, e] as const));
  const byRemoteId = new Map(args.remote.map((e) => [e.id, e] as const));
  const byMappedRemote = new Map<string, SyncSnapshotEntry>(args.snapshot.map((s) => [s.remoteId, s]));
  const byMappedLocal  = new Map<string, SyncSnapshotEntry>(args.snapshot.map((s) => [s.localId, s]));

  const out: BidirectionalDiff = {
    toCreateRemote: [], toUpdateRemote: [], toDeleteRemote: [],
    toCreateLocal: [],  toUpdateLocal: [],  toDeleteLocal: [],
    conflicts: [],
  };

  // Local items.
  for (const local of args.local) {
    const snap = byMappedLocal.get(local.id);
    if (!snap) {
      // Never synced — create remote.
      out.toCreateRemote.push(local);
      continue;
    }
    const remote = byRemoteId.get(snap.remoteId);
    if (!remote) {
      // Was synced before, gone from remote → delete locally.
      out.toDeleteLocal.push({ localId: local.id });
      continue;
    }
    const localChanged  = fingerprint(local) !== snap.localFingerprint;
    const remoteChanged = (remote.etag ?? "") !== (snap.remoteEtag ?? "");
    if (localChanged && remoteChanged) {
      out.conflicts.push({
        localId:  local.id,
        remoteId: remote.id,
        diff: explainDivergence(local, remote),
        localUpdatedAt:  local.updatedAt,
        remoteUpdatedAt: remote.updated ? new Date(remote.updated).getTime() : 0,
      });
    } else if (localChanged) {
      out.toUpdateRemote.push({ local, remoteId: remote.id, etag: remote.etag });
    } else if (remoteChanged) {
      out.toUpdateLocal.push({ remoteEvent: remote, localId: local.id });
    }
  }

  // Remote items not seen locally.
  for (const remote of args.remote) {
    if (!byMappedRemote.has(remote.id)) {
      // Brand new on remote → bring local.
      out.toCreateLocal.push(googleToTimed(remote));
      continue;
    }
  }

  // Tombstones — snapshot entries with neither local nor remote.
  for (const snap of args.snapshot) {
    const stillLocal = byLocalId.has(snap.localId);
    const stillRemote = byRemoteId.has(snap.remoteId);
    if (!stillLocal && stillRemote) out.toDeleteRemote.push({ remoteId: snap.remoteId });
    if (stillLocal && !stillRemote) out.toDeleteLocal.push({ localId: snap.localId });
  }

  return out;
}

/* ───────────── conflict resolution ───────────── */

export type ConflictPolicy = "prefer-local" | "prefer-remote" | "prefer-newer";

export function resolveSyncConflict(
  conflict: SyncConflict,
  policy: ConflictPolicy = "prefer-newer",
): "use-local" | "use-remote" {
  switch (policy) {
    case "prefer-local":  return "use-local";
    case "prefer-remote": return "use-remote";
    case "prefer-newer":
      return conflict.localUpdatedAt >= conflict.remoteUpdatedAt ? "use-local" : "use-remote";
  }
}

/* ───────────── mapping ───────────── */

export function timedToGoogle(e: TimedEvent): GoogleEvent {
  return {
    id: e.externalId ?? "",
    summary: e.title,
    description: e.description,
    location: e.location,
    start: { dateTime: e.start, timeZone: e.timeZone },
    end:   { dateTime: e.end,   timeZone: e.timeZone },
    attendees: e.attendees?.map((a) => ({
      email: a.email,
      displayName: a.name,
      responseStatus: a.rsvp === "accepted" ? "accepted"
                    : a.rsvp === "declined" ? "declined"
                    : a.rsvp === "tentative" ? "tentative"
                    : "needsAction",
    })),
    status: "confirmed",
  };
}

export function googleToTimed(g: GoogleEvent, projectId = "personal", ownerId = "self"): TimedEvent {
  const start = g.start.dateTime ?? `${g.start.date}T00:00:00Z`;
  const end   = g.end.dateTime   ?? `${g.end.date}T23:59:59Z`;
  const durationMinutes = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000));
  return {
    id: `gcal_${g.id}`,
    projectId,
    ownerId,
    title: g.summary ?? "(no title)",
    description: g.description,
    kind: "event",
    eventKind: "meeting",
    start, end,
    energy: "shallow",
    durationMinutes,
    timeZone: g.start.timeZone ?? "UTC",
    priority: { score: 0, factors: [] },
    pinned: true,
    autoPlaced: false,
    location: g.location,
    attendees: (g.attendees ?? []).map((a) => ({
      name: a.displayName ?? a.email ?? "Unknown",
      email: a.email,
      rsvp: a.responseStatus === "accepted"     ? "accepted"
          : a.responseStatus === "declined"     ? "declined"
          : a.responseStatus === "tentative"    ? "tentative"
          : "needs-action",
    })),
    externalId: g.id,
    externalSource: "google",
    externalEtag: g.etag,
    createdAt: Date.now(),
    updatedAt: g.updated ? new Date(g.updated).getTime() : Date.now(),
  };
}

/* ───────────── helpers ───────────── */

function fingerprint(e: TimedEvent): string {
  // Stable hash of the fields that round-trip to remote. djb2 — good
  // enough for change detection; we don't need cryptographic strength.
  const blob = [e.title, e.start, e.end, e.location ?? "", e.description ?? "", JSON.stringify(e.attendees ?? [])].join("|");
  let h = 5381;
  for (let i = 0; i < blob.length; i++) h = ((h * 33) ^ blob.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function explainDivergence(local: TimedEvent, remote: GoogleEvent): string {
  const diffs: string[] = [];
  if (local.title !== remote.summary) diffs.push(`title: "${local.title}" vs "${remote.summary ?? ""}"`);
  const remoteStart = remote.start.dateTime ?? remote.start.date ?? "";
  if (local.start !== remoteStart) diffs.push(`start: ${local.start} vs ${remoteStart}`);
  const remoteEnd = remote.end.dateTime ?? remote.end.date ?? "";
  if (local.end !== remoteEnd) diffs.push(`end: ${local.end} vs ${remoteEnd}`);
  if ((local.location ?? "") !== (remote.location ?? "")) diffs.push("location changed");
  if (diffs.length === 0) diffs.push("metadata divergence");
  return diffs.join("; ");
}
