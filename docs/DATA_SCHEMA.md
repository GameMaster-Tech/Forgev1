# Forge — canonical data schema

> Single source of truth for every Firestore collection Forge writes
> or reads. Updated for the feature surface as of this commit (Sync,
> Pulse, Lattice, Tempo, Calendar, Habits, Goals, Collab, Notifications,
> Sharing, Versions, Activity, Templates, IO).

## 1. Feature → simple-label map

The product ships **brand names** (Sync, Pulse, Lattice, Tempo) because
they communicate the *thesis* — Forge is an Epistemic Compiler. At the
data layer we use direct, plain-English labels so collection paths and
indexes are unambiguous.

| Feature (brand) | Schema label    | One-line domain                                           |
| --------------- | --------------- | --------------------------------------------------------- |
| Sync            | `constraints`   | Cross-document constraint compiler                         |
| Pulse           | `freshness`     | Truth-decay + reality-diff                                 |
| Lattice         | `plan`          | Recursive task decomposition                               |
| Tempo           | `schedule`      | AI-native scheduler                                        |
| Calendar        | `calendar`      | Time grid + events                                         |
| Habits          | `habits`        | Recurring intentions with streak tracking                  |
| Goals           | `goals`         | Long-running outcomes with weekly minute targets           |
| Collab          | `collab`        | Yjs CRDT presence + persistence                            |
| Notifications   | `notifications` | In-app alerts + preferences                                |
| Sharing         | `sharing`       | 5-role permissions + expiring public links                 |
| Versions        | `versions`      | Time-travel log                                            |
| Activity        | `activity`      | Global system event feed                                   |
| Templates       | `templates`     | Starter projects (Founder / Researcher / Consultant / Policy / Legal) |
| IO              | `io`            | Export/Import manifests + history                          |

## 2. Storage scopes

Every collection lives in exactly one of three scopes:

- **User-scoped**: `users/{uid}/...` — owner-only by default.
- **Project-scoped** (nested inside user): `users/{uid}/projects/{pid}/...` — owner + share-granted users.
- **Public**: top-level `publicLinks/{token}`, `templates/{key}` — token-protected or read-only.

No collection sits at the database root except `publicLinks` and `templates`. Everything else hangs off `users/{uid}/`.

## 3. Collection catalog (canonical paths)

### 3.1 Calendar — `calendar` label
```
users/{uid}/calendar/events/{eventId}                    # TimedEvent (one per meeting/deadline/focus block)
users/{uid}/calendar/tasks/{taskId}                      # Task (open work)
users/{uid}/calendar/habits/{habitId}                    # Habit (RRULE-driven)
users/{uid}/calendar/habits/{habitId}/completions/{YYYY-MM-DD}  # CompletionEntry
users/{uid}/calendar/goals/{goalId}                      # Goal (long-running)
users/{uid}/calendar/focusBlocks/{blockId}               # FocusBlock (Tempo placement)
users/{uid}/calendar/goalBlocks/{blockId}                # GoalBlock (Tempo placement)
users/{uid}/calendar/routines/active                     # UserRoutine (singleton)
```

### 3.2 Integrations — `integrations` label
```
users/{uid}/integrations/google                          # IntegrationDoc
users/{uid}/integrations/google/snapshot/{snapId}        # SyncSnapshotEntry (one per mapped event)
```

### 3.3 Projects (Sync + Pulse + Lattice + Collab)
```
users/{uid}/projects/{pid}                                  # Project metadata
users/{uid}/projects/{pid}/constraints/{constraintId}       # Sync: ConstraintEdge
users/{uid}/projects/{pid}/assertions/{assertionId}         # Sync: Assertion (the typed variable)
users/{uid}/projects/{pid}/documents/{docId}                # Project document
users/{uid}/projects/{pid}/blocks/{blockId}                 # Pulse: ContentBlock (prose chunk)
users/{uid}/projects/{pid}/plan/trees/{rootId}              # Lattice: TaskTree root metadata
users/{uid}/projects/{pid}/plan/subtasks/{taskId}           # Lattice: AtomicSubtask
users/{uid}/projects/{pid}/sync/undoLog/{patchId}           # Sync: applied patch (last 10, circular)
users/{uid}/projects/{pid}/pulse/refactors/{proposalId}     # Pulse: refactor proposal history
users/{uid}/projects/{pid}/pulse/rejections/{rejectionId}   # Pulse: per-block 7-day cooldown
users/{uid}/projects/{pid}/yjs/{guid}/updates/{updateId}    # Collab: incremental Yjs update
users/{uid}/projects/{pid}/yjs/{guid}/_snapshot/current     # Collab: compacted full state vector
users/{uid}/projects/{pid}/shares/{grantId}                 # ShareGrant (per-project)
users/{uid}/projects/{pid}/io/exports/{exportId}            # ExportManifest history
users/{uid}/projects/{pid}/io/imports/{importId}            # Import audit row
```

### 3.4 Notifications — `notifications` label
```
users/{uid}/notifications/{notifId}                      # Notification (most recent 200)
users/{uid}/notifications/_preferences                   # NotificationPreferences (singleton)
```

### 3.5 Realtime — `realtime` label
```
users/{uid}/realtime/events/{eventId}                    # CalendarRealtimeEvent + ttlExpiresAt
                                                          # Firestore TTL policy must be enabled on this field
```

### 3.6 Activity — `activity` label
```
users/{uid}/activity/{eventId}                           # ActivityEvent (every system event)
```

### 3.7 Versions — `versions` label
```
users/{uid}/versions/{versionId}                         # Version (Sync patch / Pulse refactor / Lattice rebranch / etc.)
```

### 3.8 Sharing — `sharing` label
```
users/{uid}/calendar/shares/{grantId}                    # ShareGrant (calendar-level)
users/{uid}/projects/{pid}/shares/{grantId}              # ShareGrant (project-level, mirrored above)
publicLinks/{token}                                       # PublicLinkShare (token = doc id)
```

### 3.9 Templates — `templates` label
```
templates/{key}                                          # Read-only canonical template (founder/researcher/...)
users/{uid}/templates/instantiations/{projectId}         # Audit: which template seeded which project
```

## 4. Document shapes

Each row mirrors a TypeScript interface declared in `src/lib/`. The
type is authoritative; this list is the wire shape.

### 4.1 `users/{uid}/calendar/events/{eventId}`
Mirrors `TimedEvent` (src/lib/scheduler/types.ts). Required:
```ts
{
  id, projectId|null, ownerId,
  title, description?,
  kind: "event",
  eventKind: "meeting" | "deadline" | "focus" | "personal" | "sync-window" | "pulse-sync" | "decay-horizon" | "patch-review" | "deadline-conflict",
  start: ISO, end: ISO,
  energy: "deep" | "shallow" | "creative" | "social" | "rest",
  durationMinutes: number,
  timeZone: string,
  priority: { score: number; factors: PriorityFactor[] },
  pinned: boolean, autoPlaced: boolean,
  attendees?: { name, email?, rsvp? }[],
  externalId?: string, externalSource?: "google" | "outlook" | "ical", externalEtag?: string,
  createdAt: number, updatedAt: number,
}
```

### 4.2 `users/{uid}/calendar/tasks/{taskId}`
Mirrors `Task`. Same base as TimedEvent plus:
```ts
{
  kind: "task",
  start: null | ISO, end: null | ISO,        // null until Tempo schedules
  due?: ISO,
  splittable: boolean, minBlockMinutes?: number,
  progress: 0..1,
  status: "open" | "in_progress" | "done" | "abandoned",
  boundAssertionKeys?: string[],              // Decay-aware urgency
  boundTaskId?: string,                       // Lattice cross-ref
  boundGoalId?: string,                       // Goal gravity
}
```

### 4.3 `users/{uid}/calendar/habits/{habitId}`
Mirrors `Habit`:
```ts
{
  id, projectId, ownerId,
  title,
  rrule: "FREQ=DAILY" | "FREQ=WEEKLY;BYDAY=MO,WE,FR" | ...,
  durationMinutes: number,
  energy: Energy,
  timeZone: string,
  streak: number,                             // Current consecutive completions
  lastCompletedAt?: ISO,
  createdAt: number,
  archivedAt?: number,                        // Soft-delete only
}
```

### 4.4 `users/{uid}/calendar/habits/{habitId}/completions/{YYYY-MM-DD}`
Mirrors `CompletionEntry`. Doc id is the **completion date in habit
timezone** (`YYYY-MM-DD`) so re-completion on the same day collapses
to a single doc.
```ts
{
  date: "YYYY-MM-DD", at: number, durationMinutes?: number, note?: string,
}
```

### 4.5 `users/{uid}/calendar/goals/{goalId}`
Mirrors `Goal`:
```ts
{
  id, projectId, ownerId,
  title, description?,
  successCriteria?: string,
  targetDate?: ISO,
  weeklyMinutesTarget: number,
  loggedMinutes: number,
  status: "active" | "paused" | "achieved" | "abandoned",
  createdAt: number,
}
```

### 4.6 `users/{uid}/calendar/routines/active`
Mirrors `UserRoutine`. Singleton — exactly one per user.
```ts
{
  energyProfile: Energy[24],
  weeklyCapacityMinutes: number[7],
  meetingLoadCapsMinutes: number[7],
  protectedWindows: { weekday: 0..6; start: "HH:MM"; end: "HH:MM"; reason: string }[],
  timeZone: string,
  lastLearnedAt: number,
}
```

### 4.7 `users/{uid}/integrations/google`
```ts
{
  status: "disconnected" | "connecting" | "connected" | "revoked",
  account?: { email, displayName, primaryCalendarId, scopes: string[] },
  refreshTokenEncrypted?: { v: "v1"; iv; tag; ct },     // AES-256-GCM
  accessToken?: string,                                  // Plain — short-lived
  accessTokenExpiresAt?: number,
  connectedAt?: number, lastSyncedAt?: number,
  lastError?: { code: string; at: number; message: string },
  pushChannel?: { id, resourceId, expirationMs, tokenEncrypted: { v: "v1"; iv; tag; ct } },
}
```

### 4.8 `users/{uid}/integrations/google/snapshot/{snapId}`
```ts
{
  localId, remoteId, remoteEtag?, localFingerprint, syncedAt,
}
```
Doc id format: `${localId}__${remoteId}` — deterministic so re-syncs are upserts.

### 4.9 `users/{uid}/projects/{pid}/assertions/{assertionId}`
Mirrors `Assertion`:
```ts
{
  id, projectId, documentId,
  key: "dotted.path",                                    // e.g. "engineering.senior.salary"
  label: "Human-readable",
  kind: AssertionKind,
  value: { type: "number"; value: number; unit? } | string | date | boolean,
  sourcedAt: number, source?: string, confidence: 0..1,
  locked?: boolean,
}
```

### 4.10 `users/{uid}/projects/{pid}/constraints/{constraintId}`
```ts
{
  id, projectId,
  from: assertionId | assertionId[],
  to: assertionId,
  kind: "equals" | "sum-equals" | "less-than" | "less-than-or-equal" | "greater-than" | "greater-than-or-equal" | "implies" | "mutex" | "ratio" | "between" | "not-equals" | "divisible-by",
  tolerance?: number, operand?: number,
  severity: "hard" | "soft",
  rationale: string,
}
```

### 4.11 `users/{uid}/projects/{pid}/plan/subtasks/{taskId}`
Mirrors `AtomicSubtask`:
```ts
{
  id, parentId|null,
  title, description?,
  status: "pending" | "in_progress" | "blocked" | "complete" | "irrelevant" | "user-locked",
  userLocked: boolean,
  resolutionCondition: ResolutionCondition,             // Discriminated union (9 kinds)
  draftOutcome?: DraftOutcome,
  depth: 0..5, signature: string,
  createdAt: number, updatedAt: number, removedAt?: number,
  boundAssertionKeys: string[], boundDocumentIds: string[],
  history: StatusHistoryEntry[],                         // Bounded to last 20
  prerequisites: string[], intentTag?: string,
}
```

### 4.12 `users/{uid}/projects/{pid}/yjs/{guid}/updates/{updateId}`
```ts
{
  update: string,           // base64 Yjs binary delta
  at: number,
  peerId: string,           // For echo suppression
}
```
Auto-pruned by `compact()` every 30s + a hard 500-update cap.

### 4.13 `users/{uid}/notifications/{notifId}`
```ts
{
  id, kind: NotificationKind,                            // 12 enumerated kinds
  severity: "info" | "success" | "warn" | "error",
  at: number,
  title, summary, href?, projectId?, uid?,
  read: boolean, detail?: Record<string, unknown>,
}
```

### 4.14 `users/{uid}/realtime/events/{eventId}`
```ts
{
  id, kind, at: number,
  // ... event-specific payload
  ttlExpiresAt: Timestamp,   // Firestore TTL policy enabled on this field; auto-delete after 30 min
}
```

### 4.15 `users/{uid}/activity/{eventId}`
```ts
{
  id, source: "sync" | "pulse" | "lattice" | "tempo" | "calendar" | "habit" | "sharing" | "integration",
  kind: string,
  at: number,
  title, summary?,
  projectId?, uid,
  detail?: Record<string, unknown>,
}
```

### 4.16 `users/{uid}/versions/{versionId}`
```ts
{
  id, source: VersionSource,                             // 10 enumerated sources
  at: number,
  title, summary,
  projectId?, uid?,
  detail: Record<string, unknown>,
  restorable: boolean,
}
```

### 4.17 `users/{uid}/calendar/shares/{grantId}` + `users/{uid}/projects/{pid}/shares/{grantId}`
Mirrors `ShareGrant`:
```ts
{
  id, grantedBy, grantedAt,
  resource: { kind: "calendar" | "event" | "task" | "goal" | "project"; id: string },
  principal: { kind: "user" | "team" | "link"; id: string; displayName? },
  role: "owner" | "editor" | "commenter" | "viewer" | "free-busy",
  expiresAt?: ISO,
}
```

### 4.18 `publicLinks/{token}`
Doc id = the unguessable token itself.
```ts
{
  token, role: "viewer" | "free-busy",
  resourceKind: "calendar" | "event",
  resourceId: string,
  expiresAt?: ISO,
  grantedBy: uid, grantedAt: number,
}
```

## 5. Required composite indexes

Indexes are listed in `firestore.indexes.json`. The required composites
(in addition to Firestore's auto-created single-field indexes):

| Collection group | Fields                                          | Used by                                     |
| ---------------- | ----------------------------------------------- | ------------------------------------------- |
| `events`         | `(start ASC, status ASC)`                       | Calendar grid + GCal sync range query        |
| `events`         | `(externalId ASC, externalSource ASC)`          | GCal `remoteId → localId` lookup            |
| `tasks`          | `(due ASC, status ASC)`                         | Tempo priority queue                         |
| `tasks`          | `(boundGoalId ASC, status ASC)`                 | Goal-gravity calculation                     |
| `assertions`     | `(key ASC, sourcedAt DESC)`                     | Sync deduplication + Pulse latest-value     |
| `constraints`    | `(severity ASC, kind ASC)`                      | Sync detector ordering                       |
| `subtasks`       | `(parentId ASC, status ASC)`                    | Lattice tree traversal                       |
| `subtasks`       | `(signature ASC)`                               | Lattice rebranch dedup                       |
| `notifications`  | `(read ASC, at DESC)`                           | Bell unread query                            |
| `realtime`       | `(ttlExpiresAt ASC)`                            | Firestore TTL auto-delete                    |
| `activity`       | `(source ASC, at DESC)`                         | Activity feed filter                         |
| `activity`       | `(at DESC)`                                     | Global chronological scroll                  |
| `versions`       | `(source ASC, at DESC)`                         | History filter by source                     |
| `versions`       | `(at DESC)`                                     | Chronological scrubber                       |
| `shares`         | `(resource.kind ASC, resource.id ASC)`          | "Who has access to X?"                       |
| `shares`         | `(principal.id ASC)`                            | "What does Y have access to?"                |
| `updates`        | `(at ASC)`                                      | Yjs replay order                             |
| `completions`    | `(date DESC)`                                   | Streak walk newest-first                     |

## 6. Migrations (additive)

Forge schema evolution is **additive only**. Document any new field
here when added. Deprecated fields stay readable for one major
version, hidden in UI, then dropped via a Cloud Function migration
job — never via a destructive script.

| Version | Added                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------- |
| v0.1    | Initial schema (Sync + Pulse + Lattice cores; demo fixtures)                                        |
| v0.2    | Tempo + Calendar + Habits + Goals collections                                                       |
| v0.3    | GCal integration (`integrations/google` + snapshot subcollection)                                   |
| v0.4    | Realtime SSE events (`realtime/events` with TTL field)                                              |
| v0.5    | Lattice persistence (`projects/{pid}/plan/{trees,subtasks}`)                                        |
| v0.6    | Sync undo log (`projects/{pid}/sync/undoLog`); Pulse rejections                                     |
| v0.7    | Activity feed (`users/{uid}/activity`)                                                              |
| v0.8    | Notifications (`users/{uid}/notifications`)                                                          |
| v0.9    | Versions (`users/{uid}/versions`)                                                                   |
| v0.10   | Sharing grants + public links (`shares` + top-level `publicLinks`)                                  |
| v0.11   | Templates instantiations (`users/{uid}/templates/instantiations`)                                   |
| v0.12   | Collab Yjs persistence (`projects/{pid}/yjs/{guid}/{updates,_snapshot}`)                            |
| v0.13   | IO export/import history (`projects/{pid}/io/{exports,imports}`)                                    |

## 7. Backup + retention

- **Permanent**: project data, assertions, documents, sharing grants, versions, habits, goals, templates.
- **TTL = 30 min**: `realtime/events` (via Firestore TTL policy).
- **TTL = 7 days**: `pulse/rejections` (rejection cooldown).
- **TTL = 30 days**: `notifications` (cap at 200 most-recent regardless of age — store-level circular buffer).
- **Bounded ring** (no TTL, count cap):
  - `sync/undoLog` — 10 most recent.
  - `subtasks.history` — 20 entries per subtask.
- **Compaction**: `yjs/{guid}/updates` compacted to `_snapshot/current` every 30 s; pruning enforced at 500 docs.

## 8. Security rules

Owner-only for everything user-scoped. Sharing grants extend access
to other UIDs (read + role-gated write). Public links extend read-only
access to non-authed clients via token.

See `firestore.rules` for the canonical implementation. Every nested
project subtree, plus every direct `users/{uid}/*` subcollection
introduced in v0.7+, is wrapped in an explicit per-feature `match`
block in this commit.
