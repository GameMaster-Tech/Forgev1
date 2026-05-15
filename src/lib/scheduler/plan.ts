/**
 * Tempo planner — the single entry point that ties priority, conflict
 * detection, and focus-block packing into one call.
 *
 *   plan(request) → PlanResult
 *
 * Pure. Idempotent. Re-running `plan` with the same input always
 * returns the same output.
 *
 * Algorithm:
 *   1. Score every task with the priority engine.
 *   2. Run the packer to place focus blocks.
 *   3. Detect conflicts on the resulting schedule.
 *   4. Project overload across the planning window.
 *   5. Compose a plain-English summary the UI can show.
 */

import { detectConflicts, predictOverload, detectTimezoneMismatches, detectHabitCollisions } from "./conflict";
import { packFocusBlocks } from "./pack";
import { scoreAll } from "./priority";
import type {
  Conflict,
  PlanRequest,
  PlanResult,
  ScheduleItem,
} from "./types";

export function plan(request: PlanRequest): PlanResult {
  const now = request.now ?? Date.now();

  // 1. Score tasks (events already carry their own priority; we
  // recompute for both so the user sees consistent numbers).
  const ctx = { assertions: undefined, goals: request.goals, now };
  const scoredTasks  = scoreAll(request.tasks,  ctx);
  const scoredEvents = scoreAll(request.events, ctx);

  // 2. Pack.
  const pinned = new Set(request.pinnedIds ?? []);
  const packed = packFocusBlocks({
    events: scoredEvents,
    tasks: scoredTasks,
    habits: request.habits,
    goals: request.goals,
    rangeStart: request.rangeStart,
    rangeEnd: request.rangeEnd,
    routine: request.routine,
    pinnedIds: pinned,
    now,
  });

  // 3. Conflicts.
  const allItems: ScheduleItem[] = [...scoredEvents, ...packed.blocks, ...packed.goalBlocks];
  const conflicts: Conflict[] = [
    ...detectConflicts(allItems, { now }),
    ...detectTimezoneMismatches(scoredEvents, { now }),
    ...detectHabitCollisions(scoredEvents, request.habits, { now }),
  ];

  // 4. Overload.
  const overload = predictOverload(allItems, request.routine, request.rangeStart, request.rangeEnd);

  // 5. Summary.
  const summary = composeSummary(allItems, packed.blocks.length, packed.unscheduled.length, conflicts.length);

  return {
    items: allItems,
    newBlocks: [...packed.blocks, ...packed.goalBlocks],
    unscheduled: packed.unscheduled,
    conflicts,
    overload,
    plannedAt: now,
    summary,
  };
}

function composeSummary(items: ScheduleItem[], placed: number, unsched: number, conflicts: number): string {
  const parts: string[] = [];
  if (placed > 0) parts.push(`placed ${placed} focus block${placed === 1 ? "" : "s"}`);
  if (unsched > 0) parts.push(`${unsched} task${unsched === 1 ? "" : "s"} couldn't fit — see "Unscheduled"`);
  if (conflicts > 0) parts.push(`${conflicts} conflict${conflicts === 1 ? "" : "s"} flagged`);
  if (parts.length === 0) parts.push(`${items.length} items already in a stable state`);
  return parts.join(" · ");
}
