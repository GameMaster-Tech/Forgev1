# Tempo — Firestore schema + migrations

> All Tempo state is per-user (`users/{uid}/...`). Cross-user sharing rides on the existing `shares` collection.

## Collections

```
users/{uid}/
├── integrations/
│   ├── google                              # connection state + encrypted refresh token
│   └── google/snapshot/{snapId}            # bidirectional sync snapshot entries
│
├── calendar/
│   ├── events/{eventId}                    # TimedEvent
│   ├── tasks/{taskId}                      # Task
│   ├── habits/{habitId}                    # Habit
│   ├── goals/{goalId}                      # Goal
│   ├── focusBlocks/{blockId}               # FocusBlock (auto-placed by Tempo)
│   ├── goalBlocks/{blockId}                # GoalBlock (auto-placed by Tempo)
│   └── routines/active                     # UserRoutine
│
├── calendar/shares/{grantId}               # ShareGrant
└── calendar/publicLinks/{token}            # PublicLinkShare
```

## Document shapes

### `users/{uid}/integrations/google`

```ts
{
  status: "connected" | "disconnected" | "revoked",
  account: { email: string; displayName: string; primaryCalendarId: string },
  refreshTokenEncrypted: string,             // AES-GCM via KMS
  accessTokenExpiresAt: number,              // unix ms
  scopes: string[],
  connectedAt: number,
  lastSyncedAt?: number,
  lastError?: { code: string; at: number; message: string },
}
```

### `users/{uid}/integrations/google/snapshot/{snapId}` (one per synced event)

```ts
{
  localId: string,
  remoteId: string,
  remoteEtag?: string,
  localFingerprint: string,
  syncedAt: number,
}
```

### `users/{uid}/calendar/events/{eventId}`

Mirrors `TimedEvent` in `src/lib/scheduler/types.ts`. Key fields:

```ts
{
  id: string,                                // matches doc id
  projectId: string | null,
  ownerId: string,
  title: string,
  description?: string,
  kind: "event",
  eventKind: "meeting" | "deadline" | "focus" | "personal" | "sync-window" | "pulse-sync" | "decay-horizon" | "patch-review" | "deadline-conflict",
  start: string,                              // ISO
  end: string,                                // ISO
  energy: "deep" | "shallow" | "creative" | "social" | "rest",
  durationMinutes: number,
  timeZone: string,
  priority: { score: number; factors: Array<{ kind: string; contribution: number; reason: string }> },
  pinned: boolean,
  autoPlaced: boolean,
  attendees?: Array<{ name: string; email?: string; rsvp?: "accepted" | "declined" | "tentative" | "needs-action" }>,
  externalId?: string,
  externalSource?: "google" | "outlook" | "ical",
  externalEtag?: string,
  createdAt: number,
  updatedAt: number,
}
```

### `users/{uid}/calendar/tasks/{taskId}`

Mirrors `Task`. Notable additions:

```ts
{
  kind: "task",
  start: null | string,                      // null until scheduled by Tempo
  end:   null | string,
  due?: string,                              // hard deadline
  splittable: boolean,
  minBlockMinutes?: number,
  progress: number,                          // 0..1
  status: "open" | "in_progress" | "done" | "abandoned",
  boundAssertionKeys?: string[],
  boundTaskId?: string,                      // Lattice cross-ref
  boundGoalId?: string,
}
```

### `users/{uid}/calendar/habits/{habitId}`

```ts
{
  id, projectId, ownerId, title,
  rrule: string,                             // RFC 5545 subset (see TEMPO_ARCHITECTURE.md §6)
  durationMinutes: number,
  energy: Energy,
  timeZone: string,
  streak: number,                            // current consecutive completions
  lastCompletedAt?: string,
  createdAt: number,
  archivedAt?: number,                       // soft-delete; never hard-delete
}
```

### `users/{uid}/calendar/goals/{goalId}`

```ts
{
  id, projectId, ownerId, title, description?,
  successCriteria?: string,
  targetDate?: string,
  weeklyMinutesTarget: number,
  loggedMinutes: number,
  status: "active" | "paused" | "achieved" | "abandoned",
  createdAt: number,
}
```

### `users/{uid}/calendar/routines/active`

```ts
{
  energyProfile: Energy[24],
  weeklyCapacityMinutes: number[7],
  meetingLoadCapsMinutes: number[7],
  protectedWindows: Array<{ weekday: 0..6; start: "HH:MM"; end: "HH:MM"; reason: string }>,
  timeZone: string,
  lastLearnedAt: number,
}
```

Re-learn cadence: every 7 days, or on demand from the **Tempo → Re-learn routine** action.

### `users/{uid}/calendar/shares/{grantId}`

```ts
{
  id, grantedBy, grantedAt,
  resource:  { kind: "calendar" | "event" | "task" | "goal"; id: string },
  principal: { kind: "user" | "team" | "link"; id: string; displayName?: string },
  role: "owner" | "editor" | "commenter" | "viewer" | "free-busy",
  expiresAt?: string,
}
```

## Composite indexes — add to `firestore.indexes.json`

```json
[
  {
    "collectionGroup": "events",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "start",  "order": "ASCENDING" },
      { "fieldPath": "status", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "events",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "externalId",     "order": "ASCENDING" },
      { "fieldPath": "externalSource", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "tasks",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "due",    "order": "ASCENDING" },
      { "fieldPath": "status", "order": "ASCENDING" }
    ]
  },
  {
    "collectionGroup": "shares",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "resource.kind", "order": "ASCENDING" },
      { "fieldPath": "resource.id",   "order": "ASCENDING" }
    ]
  }
]
```

## Security rules — add to `firestore.rules`

```
match /users/{uid} {
  match /calendar/{document=**} {
    allow read, write: if request.auth.uid == uid;
  }
  match /integrations/{integration} {
    allow read, write: if request.auth.uid == uid;
  }
}

// Shared resources: a user with a non-expired grant on a resource can
// read/write per their role. The role check is enforced both in rules
// and in client code; rules are the source of truth.
match /users/{ownerUid}/calendar/events/{eventId} {
  allow read: if hasGrant(ownerUid, "event", eventId, "viewer");
  allow update: if hasGrant(ownerUid, "event", eventId, "editor");
}
function hasGrant(ownerUid, kind, id, minRole) {
  let g = get(/databases/$(database)/documents/users/$(ownerUid)/calendar/shares/$(request.auth.uid + "_" + kind + "_" + id));
  return g.data != null
      && (g.data.expiresAt == null || g.data.expiresAt > request.time)
      && roleAtLeast(g.data.role, minRole);
}
```

## Migration steps (from current state to v0.1)

1. **Add composite indexes** above. Wait for them to build (Firebase shows progress).
2. **Seed routines**: on first calendar load per user, server-side `learnRoutine()` over their last 90 days and persist to `routines/active`. Make this a one-shot Cloud Function triggered by the OAuth `connected` write.
3. **Backfill priorities**: write a one-shot job that runs `scorePriority()` over every task/event so the UI never sees a "P0" placeholder. The first `plan()` call would also do this, but the eager backfill avoids a first-render flash.
4. **Sharing collection**: empty by default; populated as users invite collaborators.

## Migration steps (future versions)

- **v0.2 — push sync.** Add a `users/{uid}/integrations/google/channel` doc storing the Google push channel id + resource id. Renew every 23h via Cloud Scheduler.
- **v0.3 — multi-calendar.** Replace `integrations/google` with `integrations/google/calendars/{calendarId}` so the user can pick which calendars to mirror.
- **v0.4 — habit completion log.** Add `habits/{habitId}/completions/{date}` for explicit streak tracking instead of the single `lastCompletedAt`.
