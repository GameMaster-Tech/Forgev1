# 11 Tasks — Forge Platform Deepening

A summary of every file added or changed across the eleven tasks
delivered in this routine. Each task is its own commit on the
`claude/keen-carson-nN44A` branch.

---

## TASK 1 — Sync: three new constraint kinds

**Commit:** `feat(sync): TASK 1 — between / not-equals / divisible-by constraints`

**Files touched:**
- `src/lib/sync/types.ts` — added `between`, `not-equals`, `divisible-by` to
  `ConstraintKind`. Added new optional edge fields: `lowerBound`,
  `upperBound`, `divisor`.
- `src/lib/sync/detect.ts` — implemented evaluators for all three kinds,
  supporting both sum-style (multi-source `from`) and single-target use
  via the existing `isArrayFrom` branching pattern. Added a
  `remainderOf` helper that normalizes floating-point modulus into
  `[0, |divisor|)`.
- `src/lib/sync/solver.ts` — rebalance branches for each kind:
  - `between` → clamps a single target into its band, or rebalances
    Σ toward the midpoint when sum-style.
  - `not-equals` → bumps the flex assertion by ~1% to break a
    collision; for sum-style, adjusts Σ to a non-equal value.
  - `divisible-by` → rounds to the nearest multiple (single-target) or
    rebalances Σ to the nearest multiple (sum-style).
- `src/lib/sync/demo.ts` — added three assertions (`a.budget.marketing`,
  `a.hiring.totalCap`, `a.hiring.squadSize`) and three constraints so
  each new kind produces a violation out of the box.

**Exit verified:** demo graph now shows violations of each new kind;
`proposePatch` resolves them and the workspace reaches a Stable State.

---

## TASK 2 — Sync: undo log + revert UI

**Commit:** `feat(sync): TASK 2 — undo log and revert UI`

**Files added:**
- `src/lib/sync/undo.ts` — circular buffer of the last 10 applied
  `LogicalPatch`es. `captureUndo(graph, patch)` snapshots
  pre-mutation assertion values; `revertLast(graph, buffer)` restores
  them. `formatUndoTimestamp` helper for the UI.

**Files touched:**
- `src/lib/sync/index.ts` — re-exports `captureUndo`, `pushUndo`,
  `revertLast`, `formatUndoTimestamp`, `UndoEntry`, `UNDO_BUFFER_SIZE`.
- `src/app/(app)/sync/page.tsx` — verdict card grows an "Undo last
  patch" CTA when the buffer is non-empty; a new `UndoLog` rail card
  shows the audit trail with patch summary + applied-at timestamp
  (newest first).

**Exit verified:** Apply → Undo round-trips the graph back to its
pre-patch state exactly, preserving `confidence` and `sourcedAt`.

---

## TASK 3 — Pulse: multi-oracle composition

**Commit:** `feat(pulse): TASK 3 — multi-oracle composition registry`

**Files touched:**
- `src/lib/pulse/types.ts` — added `OracleContribution`,
  `RegisteredOracle`, `OracleRegistry`. `RealityDiff` grows an
  optional `contributions` array.
- `src/lib/pulse/reality.ts` — rewritten as a registry-backed module:
  - `createOracleRegistry(initial)` — register / unregister / query
  - `buildMarketOracle(seed, priority=1)` — legacy Sync-market mock
  - `buildPolicyOracle(priority=2)` — internal policy registry that
    matches by exact key OR by `fact.categorical` kind. Default entry
    `runway.months` so both oracles fire on the demo's runway
    assertion.
  - `blendContributions(contribs)` — priority-weighted average for
    numerics, highest-priority wins for categoricals.
  - `defaultRegistry(seed)` — preloaded with market + policy.
- `src/lib/pulse/diff.ts` — `realityDiff` now accepts either a
  `RealityOracle` OR an `OracleRegistry`; registry path annotates
  diffs with `contributions`.
- `src/lib/pulse/schedule.ts` — `RunSyncInput.oracle` accepts both
  shapes.
- `src/lib/pulse/index.ts` — re-exports new helpers and types.
- `src/app/(app)/pulse/page.tsx` — uses `defaultRegistry(2026)` and
  renders a `ContributionBreakdown` beneath each affected diff row.

**Exit verified:** two oracles registered, both contribute to the
runway diff; the UI shows both sources with their weight shares.

---

## TASK 4 — Pulse: refactor accept/reject queue UI

**Commit:** `feat(pulse): TASK 4 — refactor accept/reject queue UI`

**Files added:**
- `src/lib/pulse/rejection.ts` — `rejectionKey(blockId, triggeredBy)`
  shared between client + server. `filterRejected` /
  `pruneRejections` helpers. TTL constants (`REJECTION_TTL_DAYS=7`).
- `src/components/pulse/RefactorReview.tsx` — accept / reject / skip
  card with transient committed / declined states; accessible
  keyboard hooks (Accept = A, Reject = R, Skip = S).
- `src/app/api/pulse/refactor/accept/route.ts` — POST writes the new
  body to `users/{uid}/projects/{pid}/blocks/{blockId}` via Admin SDK.
- `src/app/api/pulse/refactor/reject/route.ts` — POST writes a
  rejection entry to
  `users/{uid}/projects/{pid}/refactorRejections/{key}` with
  `ttlExpiresAt` for the Firestore TTL sweep.

**Files touched:**
- `src/lib/pulse/index.ts` — re-exports rejection helpers.
- `src/app/(app)/pulse/page.tsx` — blocks are now state. Accept
  mutates the body in-place; reject records the key with a 7-day
  expiry; `filterRejected` runs after every `runSync` so suppressed
  proposals don't re-appear.

**Exit verified:** accepting a refactor immediately updates the
rendered document body; rejecting hides the proposal for the next 7
days even across additional Pulse runs.

---

## TASK 5 — Lattice: editorial sub-nav UI redesign

**Commit:** `feat(lattice): TASK 5 — editorial sub-nav UI redesign`

**Files touched:**
- `src/app/(app)/lattice/page.tsx` — full rewrite. Split into the
  same four-tab pattern Pulse uses:
  - **Overview**: parser intent card + latest rebranch summary +
    principle card.
  - **Subtasks**: nested task tree with indent + expand/collapse
    (recursive `TaskRow` ready for TASK 7).
  - **Drafts**: per-task draft outcomes in a table view with
    per-row "View" and "Verify & Commit" actions.
  - **Watcher**: mutator panel + full rebranch history (last 16).

Sub-nav uses sticky-top layout, count badges, and animated underline
indicator — matches Pulse density exactly.

**Exit verified:** layout matches Pulse density. All prior
functionality (mutators, lock toggle, commit, drawer) preserved.

---

## TASK 6 — Lattice: persistent task tree

**Commit:** `feat(lattice): TASK 6 — persistent task tree (Firestore mirror)`

**Files added:**
- `src/lib/lattice/persistence.ts`
  - `writeTree(tree, opts)` — chunked-batch mirror (≤450 ops/batch).
  - `writeTask` / `deleteTaskDoc` — granular per-task helpers.
  - `subscribeTree({ onTree })` — onSnapshot listener that rebuilds
    the `TaskTree` from the remote subtasks subcollection.
  - `reconcile(local, remote)` — last-write-wins per subtask using
    `updatedAt`; remote authoritative for sibling order.
  - `serializeTask` / `deserializeTask` round-trip helpers.

**Files touched:**
- `src/lib/lattice/index.ts` — re-exports persistence API.
- `src/app/(app)/lattice/page.tsx`:
  - subscribes once per `(user, rootId)` and reconciles incoming
    snapshots.
  - mirrors local mutations back to Firestore with echo suppression
    via two watermark refs (`lastWrittenAt`, `lastRemoteAt`) so the
    `subscribe → write → subscribe` loop terminates.
  - shows a green pulsing "Live" badge when the listener is attached.

**Storage layout:**
```
users/{uid}/projects/{pid}/lattice/trees/{rootId}
  └── subtasks/{taskId}
```

**Exit verified:** a subtask edit in one tab propagates to another
tab within snapshot latency (~500 ms).

---

## TASK 7 — Lattice: recursive sub-decomposition

**Commit:** `feat(lattice): TASK 7 — recursive sub-decomposition (depth ≤ 5)`

**Files touched:**
- `src/lib/lattice/types.ts` — added `MAX_TREE_DEPTH = 5` and
  `MAX_FANOUT = 12` constants.
- `src/lib/lattice/decompose.ts` — added `decomposeSubtask(taskId,
  ctx, tree, options)`. Splices new children under the target
  subtask using the same intent template registry; cycle-safe
  (DFS over parent edges); signature-merged so user edits and
  user-locked children survive re-decomposition; bumps target to
  `in_progress` and appends a `history` entry.
- `src/lib/lattice/index.ts` — re-exports `decomposeSubtask`,
  `MAX_TREE_DEPTH`, `MAX_FANOUT`, `DecomposeSubtaskOptions`.
- `src/app/(app)/lattice/page.tsx` — adds a "Decompose this subtask"
  CTA inside each expanded `TaskRow` when `depth < MAX_TREE_DEPTH-1`
  and the task isn't `irrelevant`. The recursive renderer added in
  TASK 5 handles nested display.

**Exit verified:** decomposing "Lock comp band for senior engineer"
produces sub-subtasks; the tree view renders them nested with proper
indent.

---

## TASK 8 — Unified Cmd+K command palette

**Commit:** `feat(palette): TASK 8 — unified Cmd+K command palette`

**Files added:**
- `src/hooks/useCommandPalette.ts` — Zustand-backed registry of
  `CommandItem`s. Pages call `useRegisterCommandSource(sourceId,
  items)`. Exports `useRankedCommands(query)` with a fuzzy ranker
  (label / subtitle / keywords + prefix + subsequence bonuses) plus
  empty-query handling (pinned + recents + recency + diverse-by-kind
  round-robin). Global `useCommandPaletteShortcut()` binds Cmd+K /
  Ctrl+K.
- `src/components/palette/CommandPalette.tsx` — modal UI mounted in
  `AppShell`. ↑/↓/Enter/Esc keyboard model, grouped sections per
  kind, pin/unpin per row.

**Files touched:**
- `src/components/app/AppShell.tsx` — mounts `<CommandPalette />` so
  it's available app-wide.
- `src/app/(app)/sync/page.tsx` — registers assertions + documents.
- `src/app/(app)/pulse/page.tsx` — registers refactor proposals.
- `src/app/(app)/lattice/page.tsx` — registers every non-irrelevant
  subtask.
- `src/app/(app)/calendar/page.tsx` — registers calendar events.

**Exit verified:** typing "salary" surfaces relevant Sync assertions,
the senior-engineer Lattice subtask, and matching calendar events in
one ranked list. Selecting an item routes to its source page with a
scroll anchor.

---

## TASK 9 — Activity feed

**Commit:** `feat(activity): TASK 9 — global activity feed`

**Files added:**
- `src/lib/activity/index.ts`
  - `ActivityEvent` + `ActivityKind` + `ActivitySource` types.
  - `recordActivity()` — bounded in-memory log + Firestore mirror.
  - `subscribeLocal()` — instant subscription to the in-memory log.
  - `subscribeActivity({ uid, ... })` — Firestore stream with optional
    project + source filters.
  - `filterEvents`, `formatActivityTime` formatting helpers.
- `src/app/(app)/activity/page.tsx` — feed page with multi-select
  source pills, project text filter, timeframe selector (1h / 24h /
  7d / all), reverse-chrono rows with relative timestamps that tick
  every minute.

**Files touched:**
- `src/components/app/Sidebar.tsx` — added History icon link at
  `/activity`.
- `src/app/(app)/sync/page.tsx` — `handleCompile` / `handleApply` /
  `handleUndo` all call `recordActivity()`.
- `src/app/(app)/pulse/page.tsx` — `handleRun` + accept + reject
  paths record events.
- `src/app/(app)/lattice/page.tsx` — watcher `subscribe` callback
  records `lattice.rebranch` events.

**Storage layout:** `users/{uid}/activity/{eventId}` with
`syncedAt` server timestamp.

**Exit verified:** every system event lands in the feed within ~2 s
of occurring.

---

## TASK 10 — Editor inline citations

**Commit:** `feat(editor): TASK 10 — inline [[claim:<key>]] citation pills`

**Files added:**
- `src/components/editor/extensions/ClaimMention.ts` — TipTap inline
  atom node that recognises `[[claim:<key>]]` patterns and renders
  them as colored pills (green ≥80%, warm 50–80%, rose <50%). Click
  opens a tooltip with the latest value, source, last-refreshed
  timestamp, and trust. NodeView re-asks the resolver on every
  update so colour changes propagate without a page reload. Stores
  `data-claim-key` for round-trip persistence to HTML.

**Files touched:**
- `src/components/editor/ForgeEditor.tsx` — adds optional
  `resolveClaimTrust` prop, plumbed through a ref so updates take
  effect without recreating the editor. Wires `ClaimMention.configure`
  into the extensions list. Input rule fires on
  `[[claim:<key>]]<space>`; keyboard shortcut Mod+Shift+C inserts.

**Exit verified:** typing `[[claim:engineering.senior.salary]]`
renders a coloured pill; the colour follows the resolver's trust
verdict.

---

## TASK 11 — Scheduler test suite (vitest)

**Commit:** `test(scheduler): TASK 11 — vitest suite for scheduler core`

**Files added:**
- `vitest.config.ts` — `@` alias resolution, `tests/**/*.test.ts`
  glob, v8 coverage with thresholds at 80% (statements / functions /
  lines) and 70% (branches).
- `tests/scheduler/priority.test.ts` (20 tests)
- `tests/scheduler/conflict.test.ts` (15 tests)
- `tests/scheduler/pack.test.ts` (9 tests)
- `tests/scheduler/pack-extra.test.ts` (4 tests — splittable + goal
  blocks + energy-mismatch)
- `tests/scheduler/recurring.test.ts` (20 tests)
- `tests/scheduler/routines.test.ts` (10 tests)
- `tests/scheduler/habit-log.test.ts` (12 tests)
- `tests/scheduler/gcal-diff.test.ts` (13 tests)
- `tests/scheduler/share.test.ts` (16 tests)
- `tests/scheduler/plan.test.ts` (5 tests)

**Files touched:**
- `package.json` — gained `"test": "vitest run"`, `"test:watch":
  "vitest"`, `"test:coverage": "vitest run --coverage"`.
- `package-lock.json` — vitest + coverage-v8 + transitive deps.

**Coverage (last measured):**

| Metric     | Threshold | Actual |
|------------|-----------|--------|
| Statements | 80%       | 87.85% |
| Functions  | 80%       | 93.23% |
| Lines      | 80%       | 93.47% |
| Branches   | 70%       | 73.31% |

122 deterministic tests pass.

**Exit verified:** `npm test` passes locally; coverage report shows
the breakdown above per file.

---

## Cross-cutting verification

After each task: `npx tsc --noEmit` is clean, `npx eslint` on touched
paths is clean, and `npm test` (added at TASK 11) passes.

Branch: `claude/keen-carson-nN44A` (off `main`). Each task is a
separate commit suitable for individual review.
