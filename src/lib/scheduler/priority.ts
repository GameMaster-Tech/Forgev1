/**
 * Priority engine — scores ScheduleItems on a 0-100 axis.
 *
 * Six weighted factors, each contributing to a final score:
 *
 *   • deadline-proximity  — hyperbolic: explodes near `due`.
 *   • dependency-depth    — count of downstream blockers.
 *   • decay-urgency       — inherits from Pulse-tracked assertions.
 *   • goal-gravity        — pull toward the user's weekly minutes
 *                           target for the bound goal.
 *   • habit-streak        — protect streaks ≥ 7 days.
 *   • user-pin / manual   — boosts.
 *
 * Each factor is bounded; the sum is clamped to [0, 100]. Pure.
 */

import { trustAt } from "../pulse/decay";
import type { Assertion } from "../sync/types";
import type {
  Goal,
  PriorityFactor,
  PriorityScore,
  ScheduleItem,
  Task,
} from "./types";

export interface PriorityContext {
  assertions?: Assertion[];
  goals?: Goal[];
  /** Streak length (in days) for habit-bound items. */
  habitStreak?: number;
  now?: number;
}

const HOUR = 3600_000;
const DAY  = 86_400_000;

/* ───────────── factor weights ───────────── */

const WEIGHTS = {
  deadlineMax:    45,   // max points awarded for "right now / overdue"
  dependency:      8,   // points per downstream blocker (capped)
  decayMax:       20,
  goalMax:        18,
  habitStreakMax: 15,
  userPin:        25,
  manualFloor:    10,
  meetingLoadCap: 12,
} as const;

/** Compute a priority for one item. */
export function scorePriority(item: ScheduleItem, ctx: PriorityContext = {}): PriorityScore {
  const now = ctx.now ?? Date.now();
  const factors: PriorityFactor[] = [];

  factors.push(...deadlineFactors(item, now));
  factors.push(...decayFactors(item, ctx.assertions, now));
  factors.push(...goalFactors(item, ctx.goals));
  factors.push(...habitFactors(item, ctx.habitStreak));
  factors.push(...pinFactors(item));

  const score = clamp(0, 100, factors.reduce((acc, f) => acc + f.contribution, 0));
  return { score, factors };
}

/** Batch helper. Computes priority for many items. */
export function scoreAll<T extends ScheduleItem>(items: T[], ctx: PriorityContext = {}): T[] {
  return items.map((item) => ({ ...item, priority: scorePriority(item, ctx) }));
}

/* ───────────── factor builders ───────────── */

function deadlineFactors(item: ScheduleItem, now: number): PriorityFactor[] {
  const due = dueDateMs(item);
  if (due == null) return [];
  const remainingHours = (due - now) / HOUR;
  // Hyperbolic decay: 0h remaining → max points, 7d → near zero.
  // Formula: max * 1 / (1 + max(0, remainingHours)/24)
  const normalised = 1 / (1 + Math.max(0, remainingHours) / 24);
  const contribution = WEIGHTS.deadlineMax * (remainingHours < 0 ? 1 : normalised);
  return [{
    kind: "deadline-proximity",
    contribution,
    reason: remainingHours < 0
      ? `overdue by ${Math.abs(remainingHours).toFixed(0)}h`
      : remainingHours < 24
      ? `due in ${remainingHours.toFixed(1)}h`
      : `due in ${(remainingHours / 24).toFixed(1)}d`,
  }];
}

function decayFactors(item: ScheduleItem, assertions: Assertion[] | undefined, now: number): PriorityFactor[] {
  if (!assertions || !item.boundAssertionKeys || item.boundAssertionKeys.length === 0) return [];
  const out: PriorityFactor[] = [];
  for (const key of item.boundAssertionKeys) {
    const a = pickLatest(assertions, key);
    if (!a) continue;
    const trust = trustAt(a, now);
    // Inverse: trust 1.0 → 0 contribution, trust 0.0 → max.
    const contribution = WEIGHTS.decayMax * (1 - trust);
    if (contribution < 0.5) continue;
    out.push({
      kind: "decay-urgency",
      contribution,
      reason: `\`${key}\` trust ${(trust * 100).toFixed(0)}% — Pulse says refresh`,
    });
  }
  // Cap the cumulative decay contribution.
  const sum = out.reduce((acc, f) => acc + f.contribution, 0);
  if (sum <= WEIGHTS.decayMax) return out;
  // Scale down to the cap.
  const scale = WEIGHTS.decayMax / sum;
  return out.map((f) => ({ ...f, contribution: f.contribution * scale }));
}

function goalFactors(item: ScheduleItem, goals: Goal[] | undefined): PriorityFactor[] {
  if (!goals || !item.boundGoalId) return [];
  const goal = goals.find((g) => g.id === item.boundGoalId);
  if (!goal || goal.status !== "active") return [];
  // Goals with less-than-target weekly progress pull harder.
  const target = Math.max(1, goal.weeklyMinutesTarget);
  const fillRatio = goal.loggedMinutes / target;
  // Under-filled (ratio < 1) → full contribution. Over-filled → tapered.
  const contribution = fillRatio >= 1
    ? WEIGHTS.goalMax * 0.2
    : WEIGHTS.goalMax * (1 - fillRatio);
  return [{
    kind: "goal-gravity",
    contribution,
    reason: `goal "${goal.title}" at ${Math.round(fillRatio * 100)}% of weekly target`,
  }];
}

function habitFactors(item: ScheduleItem, streak: number | undefined): PriorityFactor[] {
  if (item.kind !== "task" && item.kind !== "event") return [];
  // Habits surface as TimedEvents post-RRULE-expansion or as Tasks for
  // skipped slots. Either way, we need the streak in context.
  if (streak === undefined || streak <= 0) return [];
  // Streak ≥ 7 protects the habit hard; smaller streaks ramp up.
  const contribution = WEIGHTS.habitStreakMax * Math.min(1, streak / 14);
  return [{
    kind: "habit-streak",
    contribution,
    reason: `streak ${streak}d — protect it`,
  }];
}

function pinFactors(item: ScheduleItem): PriorityFactor[] {
  if (item.pinned) {
    return [{
      kind: "user-pin",
      contribution: WEIGHTS.userPin,
      reason: "user pinned this slot",
    }];
  }
  return [];
}

/* ───────────── helpers ───────────── */

function dueDateMs(item: ScheduleItem): number | null {
  // Tasks have `due`. Timed events use `end` as a soft deadline (the
  // commitment lapses at the end). Focus/goal blocks have no
  // intrinsic deadline.
  if (isTask(item) && item.due) return new Date(item.due).getTime();
  if (item.kind === "event" && item.end) return new Date(item.end).getTime();
  return null;
}

function isTask(i: ScheduleItem): i is Task {
  return i.kind === "task";
}

function pickLatest(assertions: Assertion[], key: string): Assertion | undefined {
  let best: Assertion | undefined;
  for (const a of assertions) {
    if (a.key !== key) continue;
    if (!best || a.sourcedAt > best.sourcedAt) best = a;
  }
  return best;
}

function clamp(min: number, max: number, n: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * "X items above the threshold need attention this week." Used by the
 * Overview tab to surface the top of the priority queue.
 */
export function topN<T extends ScheduleItem>(items: T[], n: number, threshold = 40): T[] {
  return items
    .filter((i) => i.priority.score >= threshold)
    .sort((a, b) => b.priority.score - a.priority.score)
    .slice(0, n);
}

/** Expose constants so the doc generator can show the weights. */
export const PRIORITY_WEIGHTS = WEIGHTS;

/** Day-bucketed urgency. Useful for daily/weekly summaries. */
export function urgencyByDay(items: ScheduleItem[]): { date: string; total: number }[] {
  const map = new Map<string, number>();
  for (const i of items) {
    const ts = i.start ?? (isTask(i) && i.due) ? new Date(i.start ?? (i as Task).due!).getTime() : null;
    if (ts == null) continue;
    const date = new Date(ts).toISOString().slice(0, 10);
    map.set(date, (map.get(date) ?? 0) + i.priority.score);
  }
  return Array.from(map.entries())
    .map(([date, total]) => ({ date, total }))
    .sort((a, b) => a.date.localeCompare(b.date));
}
void DAY;
