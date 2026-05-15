# Tempo — Forge's AI-native scheduling layer

> One sentence: Tempo treats your calendar like a compiled program. Tasks, habits, goals, and meetings are interconnected variables; the scheduler is a constraint solver that explains every placement.

## 1. Competitive landscape, honestly

| Tool                | Best at                          | Where it falls short                                                |
| ------------------- | -------------------------------- | ------------------------------------------------------------------- |
| **Google Calendar** | Invites, sharing, ubiquity       | No task layer, no AI scheduling, no goal/habit primitives           |
| **Notion Calendar** | Beautiful viewer over GCal, time zones, keyboard | Read-only intelligence; no auto-schedule, no goals          |
| **Cron** (legacy)   | Same as above (pre-Notion)       | Same                                                                |
| **Motion**          | Auto-schedules tasks around meetings, rebuilds daily | Opaque ("why is this here?"); aggressive shuffling; no goal model |
| **Sunsama**         | Daily planning ritual; "shutdown" ceremony | Manual scheduling; no overload prediction; no real automation |
| **Akiflow**         | Speed; unifies inboxes (Slack, Asana, Notion) | Manual scheduling; no learning loop                       |
| **Morgen**          | Multi-calendar; integrations     | Manual focus blocks; no AI explainability                          |

**Common gap.** None of these treat **goals and habits as first-class scheduling primitives**, and none **explain their placements**. Motion auto-schedules but is famously a black box; Sunsama is mindful but manual. Notion Calendar is a viewer, not a planner.

## 2. Tempo's thesis

Four design commitments distinguish Tempo:

1. **Unified primitives.** Events, tasks, habits, and goals all implement a common `ScheduleItem` interface. The scheduler is one algorithm over one queue — not separate stacks of feature code.
2. **Explainable placement.** Every auto-placed block carries a `placementRationale: string[]`. The UI surfaces the chain: "placed in a deep window · task priority 78 · 6 hours before deadline." No black box.
3. **Decay-aware urgency.** A task bound to a Pulse-tracked assertion inherits urgency from the half-life of that data. A "review senior comp" task with a salary tracked at 55 % trust scores higher than the same task with 95 % trust.
4. **Compiler-aware conflicts.** When Sync flags a deadline that contradicts a budget, Tempo surfaces it as a scheduling conflict — not a separate alert. Time and truth share one surface.

## 3. Scoring model

Six factors, each bounded:

| Factor                | Cap pts | Trigger                                                                       |
| --------------------- | ------- | ----------------------------------------------------------------------------- |
| `deadline-proximity`  | 45      | Hyperbolic: explodes near `due`. Overdue = full points.                       |
| `decay-urgency`       | 20      | Inverse of Pulse trust for any assertion the item touches.                    |
| `goal-gravity`        | 18      | Underfilled weekly goal pulls bound items harder.                             |
| `habit-streak`        | 15      | Streaks ≥ 14 days protect themselves at full strength.                        |
| `user-pin`            | 25      | Manual user pin.                                                              |
| `dependency-depth`    |  8      | Downstream blockers (planned, currently 0 until Lattice wires it).            |

The sum is clamped to `[0, 100]`. Factors are returned with the score for UI explanation.

## 4. Conflict + overload

`detectConflicts` is exhaustive:

- pairwise time overlaps (with severity inherited from the implicated items' priority)
- double-bookings (same attendee in two events at once, RSVP-aware)
- deadline impossibility (remaining task minutes > free-budget proxy)
- time-zone mismatches (heuristic: ≥ 5 distinct attendee domains)
- habit collisions (daily habit not logged in 2+ days)

`predictOverload` bucket-loads day-by-day:

```
load = committed_minutes / capacity_minutes
```

Capacity is learned from the user's routine (median active-window per weekday). The UI renders a 5-level heatmap with explicit thresholds in `bucketLoad()`.

## 5. Packer

Greedy with one-step backtrack:

1. Score every task.
2. Compute free intervals between fixed events + protected windows.
3. Split intervals at hour boundaries so each piece has a single energy class.
4. For each task in priority order:
   - Pick the best-matching free slot using a per-energy preference list (e.g. `deep` wants `deep` then `creative`).
   - Place a `FocusBlock` consuming that slot.
   - If `splittable`, chunk across multiple sessions of `≥ minBlockMinutes` each.
   - If nothing fits, append to `unscheduled[]` with a reason.

The packer never moves pinned items, never touches protected windows, and always emits a `placementRationale`.

## 6. Routine learner

`learnRoutine(events)` derives, from the last 90 days of activity:

- 24-hour `EnergyProfile` (deep / shallow / creative / social / rest per hour-of-day) inferred from event-title heuristics + attendee count + length
- 7-day capacity vector (median active minutes per weekday)
- meeting load caps (60 % of capacity)
- protected windows (sleep, weekend, anything never occupied across ≥ 4 weeks)

No ML. Heuristics are explainable and easy to tune. The output is a `UserRoutine` the packer reads.

## 7. GCal sync

Bidirectional three-way diff in `gcal.ts`:

```
workspace  ↔  remote
       ↘  ↙
   last-known-good snapshot
```

Outputs six write classes: create-local, create-remote, update-local, update-remote, delete-local, delete-remote, plus a conflict list.

Conflict policies: `prefer-local`, `prefer-remote`, `prefer-newer` (default).

State machine (`SyncState`):

```
disconnected → authorizing → connected.idle
                  ↘ failure → disconnected
connected.idle ⇄ connected.syncing
                ↓ failure → connected.error
                ↓ 429     → connected.rate-limited
connected.idle → revoked  (user removed app from Google account)
```

Retries: exponential backoff with jitter, capped at 5 minutes per attempt.

## 8. Sharing model

Five roles, RFC-style ordering:

| Role       | Read details | Read free/busy | Comment | Edit | Reshare |
| ---------- | ------------ | -------------- | ------- | ---- | ------- |
| owner      | ✓            | ✓              | ✓       | ✓    | ✓       |
| editor     | ✓            | ✓              | ✓       | ✓    |         |
| commenter  | ✓            | ✓              | ✓       |      |         |
| viewer     | ✓            | ✓              |         |      |         |
| free-busy  |              | ✓              |         |      |         |

Plus expiry-aware **public link** shares for "view-only" or "free-busy" workflows.

## 9. Why it improves over the leaders

- **vs. Motion.** Same auto-scheduling, but every placement is explained, every conflict is named, and the user retains the lock primitive (`pinned`) without dropping into manual mode.
- **vs. Sunsama.** Same mindful daily ritual is possible (drag-and-drop your priority queue), but Tempo *fills* the focus blocks for you — Sunsama makes you place each one by hand.
- **vs. Notion Calendar / Cron.** Same minimalist UI, but Tempo isn't a viewer — it's a planner with the same visual restraint.
- **vs. Akiflow.** Same unified inbox model could be added (Lattice already does cross-doc decomposition; wiring third-party inboxes is a follow-on), but with auto-scheduling on top.

## 10. What this turn ships vs. what's next

**Ships now (production-quality, headless TypeScript):**

- Full type contract (`types.ts`, 240 LOC, no `any`)
- Priority engine with six bounded factors and `topN()` helper
- Exhaustive conflict + overload engine
- Greedy focus-block packer with energy-fit and splitability
- RFC 5545 RRULE expander (DAILY/WEEKLY/MONTHLY/YEARLY + INTERVAL/BYDAY/BYMONTHDAY/UNTIL/COUNT/EXDATE)
- Heuristic routine learner from 90-day history
- Permissions + public-link share model
- Bidirectional GCal three-way diff + state machine + backoff
- Tempo tab in the Calendar UI demonstrating priority queue, overload heatmap, placed focus blocks, conflicts, and unscheduled work

**Next (roadmap, not in this turn):**

- Server-side OAuth route handler at `/api/integrations/google/callback`
- Firestore mirror of the sync snapshot for cross-device dedup
- WebSocket / Server-Sent-Events push for "another tab edited this" cases
- Habit completion logging UI + streak protection in the packer
- Goal gravity surfaced as visual "goal-block" placements (typed, packer stub exists)
- Dependency-depth factor (needs Lattice prerequisite graph to wire in)
