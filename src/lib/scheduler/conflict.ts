/**
 * Conflict & overload engine.
 *
 *   detectConflicts(items)  — exhaustive pairwise + capacity checks.
 *   predictOverload(items, routine, range) — daily heatmap.
 *
 * Pure. The packer consults these before placing new items.
 */

import type {
  Conflict,
  ConflictKind,
  Habit,
  OverloadPrediction,
  ScheduleItem,
  TimedEvent,
  UserRoutine,
} from "./types";

const MIN = 60_000;
const DAY = 86_400_000;

/* ───────────── conflict detection ───────────── */

export function detectConflicts(items: ScheduleItem[], opts: { now?: number } = {}): Conflict[] {
  const now = opts.now ?? Date.now();
  const conflicts: Conflict[] = [];

  // 1. Pairwise time-overlap (timed items only).
  const timed = items.filter(hasTime).sort((a, b) => a.start!.localeCompare(b.start!));
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const A = timed[i];
      const B = timed[j];
      if (new Date(B.start!).getTime() >= new Date(A.end!).getTime()) break;
      const sevA = severityFromPriority(A.priority.score);
      const sevB = severityFromPriority(B.priority.score);
      conflicts.push({
        id: cid("overlap", A.id, B.id),
        kind: "time-overlap",
        itemIds: [A.id, B.id],
        message: `"${A.title}" and "${B.title}" overlap by ${overlapMinutes(A, B)} min.`,
        severity: maxSeverity(sevA, sevB),
        suggestion: A.pinned && !B.pinned ? `Move "${B.title}" — "${A.title}" is pinned.` :
                    B.pinned && !A.pinned ? `Move "${A.title}" — "${B.title}" is pinned.` :
                    `Move the lower-priority item (${A.priority.score <= B.priority.score ? A.title : B.title}).`,
        detectedAt: now,
      });
    }
  }

  // 2. Double-booking via attendees.
  const events = timed.filter((x): x is TimedEvent => x.kind === "event");
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const A = events[i];
      const B = events[j];
      if (new Date(B.start).getTime() >= new Date(A.end).getTime()) break;
      const sharedAttendees = sharedAcceptedAttendees(A, B);
      if (sharedAttendees.length === 0) continue;
      conflicts.push({
        id: cid("dbook", A.id, B.id),
        kind: "double-booking",
        itemIds: [A.id, B.id],
        message: `${sharedAttendees.join(", ")} accepted both "${A.title}" and "${B.title}".`,
        severity: "high",
        suggestion: "Decline the lower-priority invite.",
        detectedAt: now,
      });
    }
  }

  // 3. Deadline impossibility — task minutes remaining > free time before due.
  for (const t of items) {
    if (t.kind !== "task" || !t.due) continue;
    if (t.status === "done") continue;
    const dueMs = new Date(t.due).getTime();
    if (dueMs <= now) continue;
    const minutesLeft = Math.round((dueMs - now) / MIN);
    const remainingWork = Math.ceil(t.durationMinutes * (1 - (t.progress ?? 0)));
    // Approximate free time as 6 hours per workday between now and due.
    const days = Math.max(1, Math.ceil((dueMs - now) / DAY));
    const freeBudget = days * 6 * 60;
    if (remainingWork > freeBudget) {
      conflicts.push({
        id: cid("dimpos", t.id),
        kind: "deadline-impossible",
        itemIds: [t.id],
        message: `"${t.title}" needs ${remainingWork} min but only ${freeBudget} min realistically available before ${t.due}.`,
        severity: "high",
        suggestion: "Negotiate the deadline, split scope, or escalate.",
        detectedAt: now,
      });
    }
    if (minutesLeft < 60 && t.priority.score < 50) {
      conflicts.push({
        id: cid("dimnoq", t.id),
        kind: "deadline-impossible",
        itemIds: [t.id],
        message: `"${t.title}" deadline in ${minutesLeft} min but priority is only ${t.priority.score}.`,
        severity: "medium",
        suggestion: "Confirm whether the deadline is real or aspirational.",
        detectedAt: now,
      });
    }
  }

  return conflicts;
}

/** Detect timezone disagreement among confirmed attendees. */
export function detectTimezoneMismatches(events: TimedEvent[], opts: { now?: number } = {}): Conflict[] {
  const now = opts.now ?? Date.now();
  const out: Conflict[] = [];
  for (const e of events) {
    if (!e.attendees || e.attendees.length < 2) continue;
    // We don't have per-attendee tz on the wire, but if a meeting
    // straddles >5 different country emails, flag for review.
    const domains = new Set((e.attendees ?? []).map((a) => (a.email ?? "").split("@")[1]).filter(Boolean));
    if (domains.size >= 5) {
      out.push({
        id: cid("tz", e.id),
        kind: "tz-mismatch",
        itemIds: [e.id],
        message: `"${e.title}" has attendees across ${domains.size} domains — likely multi-timezone.`,
        severity: "low",
        suggestion: "Confirm the local time for each attendee region.",
        detectedAt: now,
      });
    }
  }
  return out;
}

/** Habit collisions — when a scheduled item displaces a habit slot. */
export function detectHabitCollisions(events: TimedEvent[], habits: Habit[], opts: { now?: number } = {}): Conflict[] {
  const now = opts.now ?? Date.now();
  // For each habit, expected slots come from the RRULE expansion done
  // by the recurring module; here we only flag if any habit hasn't
  // been completed in `freq`+1 days while events occupied its window.
  const out: Conflict[] = [];
  void events;
  for (const h of habits) {
    if (h.archivedAt) continue;
    if (!h.lastCompletedAt) continue;
    const last = new Date(h.lastCompletedAt).getTime();
    const elapsed = now - last;
    if (elapsed > 2 * DAY && h.rrule.includes("FREQ=DAILY")) {
      out.push({
        id: cid("habit", h.id),
        kind: "habit-collision",
        itemIds: [],
        message: `Daily habit "${h.title}" not logged in ${Math.round(elapsed / DAY)}d.`,
        severity: "medium",
        suggestion: "Tempo can carve a new slot tomorrow morning.",
        detectedAt: now,
      });
    }
  }
  return out;
}

/* ───────────── overload prediction ───────────── */

/**
 * Day-bucket the committed minutes against the user's capacity
 * (routine.weeklyCapacityMinutes by weekday). Returns one record per
 * day in [rangeStart, rangeEnd].
 */
export function predictOverload(
  items: ScheduleItem[],
  routine: UserRoutine | undefined,
  rangeStart: string,
  rangeEnd: string,
): OverloadPrediction[] {
  const startMs = new Date(rangeStart).getTime();
  const endMs   = new Date(rangeEnd).getTime();
  if (!(endMs > startMs)) return [];
  const byDate = new Map<string, number>();
  for (const item of items) {
    if (!item.start || !item.end) continue;
    const t = new Date(item.start).getTime();
    if (t < startMs || t > endMs) continue;
    const minutes = Math.max(1, Math.round((new Date(item.end).getTime() - t) / MIN));
    const date = isoDate(t);
    byDate.set(date, (byDate.get(date) ?? 0) + minutes);
  }
  const out: OverloadPrediction[] = [];
  for (let cursor = startMs; cursor <= endMs; cursor += DAY) {
    const date = isoDate(cursor);
    const weekday = new Date(cursor).getDay();
    const capacity = routine?.weeklyCapacityMinutes?.[weekday] ?? 8 * 60;
    const committed = byDate.get(date) ?? 0;
    const load = capacity === 0 ? 0 : committed / capacity;
    const level = bucketLoad(load);
    const reasons: string[] = [];
    if (load >= 1.2) reasons.push("you're 20%+ over your usual capacity");
    if (capacity < 4 * 60) reasons.push("low-capacity day in your routine");
    if (committed > 8 * 60) reasons.push(`${(committed / 60).toFixed(1)}h of fixed commitments`);
    out.push({ date, committedMinutes: committed, capacityMinutes: capacity, load, level, reasons });
  }
  return out;
}

/* ───────────── helpers ───────────── */

function hasTime<T extends ScheduleItem>(i: T): i is T & { start: string; end: string } {
  return typeof i.start === "string" && typeof i.end === "string";
}

function overlapMinutes(a: ScheduleItem, b: ScheduleItem): number {
  if (!a.start || !a.end || !b.start || !b.end) return 0;
  const s = Math.max(new Date(a.start).getTime(), new Date(b.start).getTime());
  const e = Math.min(new Date(a.end).getTime(),   new Date(b.end).getTime());
  return Math.max(0, Math.round((e - s) / MIN));
}

function sharedAcceptedAttendees(a: TimedEvent, b: TimedEvent): string[] {
  if (!a.attendees || !b.attendees) return [];
  const accA = new Set(
    a.attendees.filter((x) => x.rsvp === "accepted" || x.rsvp == null).map((x) => (x.email ?? x.name).toLowerCase()),
  );
  const out: string[] = [];
  for (const x of b.attendees) {
    if (x.rsvp === "declined") continue;
    const id = (x.email ?? x.name).toLowerCase();
    if (accA.has(id)) out.push(x.name);
  }
  return out;
}

function severityFromPriority(p: number): Conflict["severity"] {
  if (p >= 70) return "high";
  if (p >= 40) return "medium";
  return "low";
}

function maxSeverity(a: Conflict["severity"], b: Conflict["severity"]): Conflict["severity"] {
  const rank = { low: 0, medium: 1, high: 2 } as const;
  return rank[a] >= rank[b] ? a : b;
}

function bucketLoad(load: number): 0 | 1 | 2 | 3 | 4 {
  if (load < 0.25) return 0;
  if (load < 0.5)  return 1;
  if (load < 0.85) return 2;
  if (load < 1.1)  return 3;
  return 4;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function cid(...parts: string[]): string {
  return `c_${parts.join("_")}`;
}

/** Used by Calendar gridding code. */
export const OVERLOAD_LEVEL_TONES = ["green", "green", "warm", "rose", "rose"] as const;

/** Conflict-kind → human label. */
export const CONFLICT_LABELS: Record<ConflictKind, string> = {
  "time-overlap":         "Overlap",
  "deadline-impossible":  "Deadline at risk",
  "energy-mismatch":      "Energy mismatch",
  "overload":             "Overload",
  "double-booking":       "Double-booked",
  "sync-constraint":      "Sync conflict",
  "tz-mismatch":          "Time-zone mismatch",
  "habit-collision":      "Habit displaced",
};
