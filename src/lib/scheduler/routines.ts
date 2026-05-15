/**
 * Routine learner — infers the user's energy profile, weekly capacity,
 * and protected windows from historical calendar activity.
 *
 *   inferEnergyProfile(events) — clusters past events by hour and
 *   energy class (deep / shallow / etc.) using metadata heuristics
 *   (length, attendee count, title keywords, recurrence).
 *
 *   inferProtectedWindows(events) — finds recurring "always off" slots.
 *
 *   inferWeeklyCapacity(events) — fits a 7-day capacity vector from
 *   median active minutes per weekday.
 *
 * No ML — heuristic rules that are explainable and easily tunable.
 */

import {
  DEFAULT_ENERGY_PROFILE,
  type Energy,
  type EnergyProfile,
  type ProtectedWindow,
  type TimedEvent,
  type UserRoutine,
} from "./types";

const DAY = 86_400_000;
const MIN = 60_000;

interface LearnInput {
  events: TimedEvent[];
  /** Window of history to use. Default last 90 days from `now`. */
  historyDays?: number;
  now?: number;
  /** ISO time zone the user lives in. */
  timeZone?: string;
}

export function learnRoutine(input: LearnInput): UserRoutine {
  const now = input.now ?? Date.now();
  const historyDays = input.historyDays ?? 90;
  const cutoff = now - historyDays * DAY;
  const recent = input.events.filter((e) => new Date(e.end).getTime() >= cutoff && new Date(e.start).getTime() <= now);

  return {
    id: `routine_${now.toString(36)}`,
    ownerId: input.events[0]?.ownerId ?? "self",
    energyProfile: inferEnergyProfile(recent),
    weeklyCapacityMinutes: inferWeeklyCapacity(recent),
    meetingLoadCapsMinutes: inferMeetingLoadCaps(recent),
    protectedWindows: inferProtectedWindows(recent),
    timeZone: input.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
    lastLearnedAt: now,
  };
}

/* ───────────── energy profile ───────────── */

/**
 * For each hour-of-day, what energy class does the user typically use it for?
 * Heuristic:
 *   • events with >= 4 attendees ⇒ social
 *   • events with title matching /focus|deep|maker|build/ ⇒ deep
 *   • events with title matching /standup|sync|1[:.]1/ ⇒ shallow
 *   • events with title matching /design|brainstorm|writing/ ⇒ creative
 *   • everything else ⇒ shallow
 *
 * Unbusy hours default to the global profile.
 */
export function inferEnergyProfile(events: TimedEvent[]): EnergyProfile {
  const buckets: Record<Energy, number>[] = Array.from({ length: 24 }, () => ({ deep: 0, creative: 0, shallow: 0, social: 0, rest: 0 }));

  for (const e of events) {
    if (e.kind !== "event") continue;
    const start = new Date(e.start);
    const end = new Date(e.end);
    let cursor = new Date(start);
    while (cursor < end) {
      const hour = cursor.getHours();
      const classed = classify(e);
      buckets[hour][classed]++;
      cursor = new Date(cursor.getTime() + 30 * MIN); // 30-min granularity
    }
  }

  const profile: EnergyProfile = [...DEFAULT_ENERGY_PROFILE];
  for (let h = 0; h < 24; h++) {
    const b = buckets[h];
    const winner = pickMax(b);
    if (winner.count >= 3) {
      profile[h] = winner.kind;
    }
  }
  return profile;
}

function classify(e: TimedEvent): Energy {
  const title = (e.title ?? "").toLowerCase();
  const minutes = Math.max(1, (new Date(e.end).getTime() - new Date(e.start).getTime()) / MIN);
  if (/focus|deep|maker|build|coding/.test(title)) return "deep";
  if (/design|brainstorm|writing|sketch/.test(title)) return "creative";
  if (/standup|sync|1[:.]1|check.?in/.test(title)) return "shallow";
  if ((e.attendees?.length ?? 0) >= 4) return "social";
  if (minutes <= 30) return "shallow";
  return "shallow";
}

function pickMax<T extends string>(o: Record<T, number>): { kind: T; count: number } {
  let bestK: T | null = null;
  let bestC = -1;
  for (const k of Object.keys(o) as T[]) {
    if (o[k] > bestC) {
      bestC = o[k];
      bestK = k;
    }
  }
  return { kind: bestK!, count: bestC };
}

/* ───────────── weekly capacity ───────────── */

/**
 * For each weekday (0=Sunday), how many minutes does the user
 * typically work? Use median active minutes between their first and
 * last event of each weekday.
 */
export function inferWeeklyCapacity(events: TimedEvent[]): number[] {
  const perWeekday: number[][] = Array.from({ length: 7 }, () => []);
  const buckets = new Map<string, { first: number; last: number }>();
  for (const e of events) {
    if (e.kind !== "event") continue;
    const d = new Date(e.start);
    const key = d.toISOString().slice(0, 10);
    const start = new Date(e.start).getTime();
    const end = new Date(e.end).getTime();
    const bucket = buckets.get(key);
    if (!bucket) buckets.set(key, { first: start, last: end });
    else {
      bucket.first = Math.min(bucket.first, start);
      bucket.last  = Math.max(bucket.last,  end);
    }
  }
  for (const [date, b] of buckets) {
    const dow = new Date(date).getDay();
    const minutes = Math.max(0, Math.round((b.last - b.first) / MIN));
    if (minutes > 30) perWeekday[dow].push(minutes);
  }
  return perWeekday.map((arr) => arr.length ? median(arr) : defaultCapacityFor(perWeekday.indexOf(arr)));
}

function defaultCapacityFor(weekday: number): number {
  // Weekends default to 0, weekdays to 8h.
  if (weekday === 0 || weekday === 6) return 0;
  return 8 * 60;
}

/* ───────────── meeting load caps ───────────── */

/**
 * Heuristic ceiling: 60% of weekly capacity per day. The packer uses
 * this to refuse "stacking another meeting" past the cap.
 */
export function inferMeetingLoadCaps(events: TimedEvent[]): number[] {
  return inferWeeklyCapacity(events).map((cap) => Math.round(cap * 0.6));
}

/* ───────────── protected windows ───────────── */

/**
 * Find hour-of-day, weekday slots that are NEVER occupied in the
 * sample. Output as `ProtectedWindow`s the packer must not violate.
 *
 * Conservative: only emits a protected window if it's empty in at
 * least 4 weeks of data.
 */
export function inferProtectedWindows(events: TimedEvent[]): ProtectedWindow[] {
  // Mark every (weekday, hour) that was occupied at least once.
  const occupied = new Set<string>();
  let weeksObserved = 0;
  const minDate = events.length ? Math.min(...events.map((e) => new Date(e.start).getTime())) : Date.now();
  const maxDate = events.length ? Math.max(...events.map((e) => new Date(e.start).getTime())) : Date.now();
  weeksObserved = Math.max(1, Math.round((maxDate - minDate) / (7 * DAY)));
  for (const e of events) {
    const s = new Date(e.start);
    const en = new Date(e.end);
    let cur = new Date(s);
    while (cur < en) {
      const key = `${cur.getDay()}.${cur.getHours()}`;
      occupied.add(key);
      cur = new Date(cur.getTime() + 30 * MIN);
    }
  }
  if (weeksObserved < 4) return [];

  // Emit a window for the "never on weekend" pattern only if true.
  const out: ProtectedWindow[] = [];
  for (const dow of [0, 6]) {
    let saturdayClear = true;
    for (let h = 9; h <= 17; h++) {
      if (occupied.has(`${dow}.${h}`)) { saturdayClear = false; break; }
    }
    if (saturdayClear) {
      out.push({ weekday: dow, start: "00:00", end: "23:59", reason: "weekend protected" });
    }
  }
  // Sleep window — 23-06 always off if data permits.
  let sleepClear = true;
  for (let dow = 0; dow < 7 && sleepClear; dow++) {
    for (const h of [23, 0, 1, 2, 3, 4, 5]) {
      if (occupied.has(`${dow}.${h}`)) { sleepClear = false; break; }
    }
  }
  if (sleepClear) {
    for (let dow = 0; dow < 7; dow++) {
      out.push({ weekday: dow, start: "23:00", end: "06:00", reason: "sleep" });
    }
  }
  return out;
}

/* ───────────── helpers ───────────── */

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}
