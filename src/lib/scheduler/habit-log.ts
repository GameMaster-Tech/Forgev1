/**
 * Habit completion log + streak math.
 *
 * Storage shape:
 *   users/{uid}/calendar/habits/{habitId}/completions/{YYYY-MM-DD}
 *     { date: ISO, at: number, durationMinutes?: number, note?: string }
 *
 * Pure functions here; persistence happens via the server actions in
 * /api/calendar/habits/[habitId]/complete/route.ts.
 *
 * Streak rules:
 *   • DAILY habit: streak increments by 1 each consecutive day completed.
 *   • WEEKLY habit (BYDAY=...): streak increments per completed-on-schedule week.
 *   • A missed day breaks DAILY streak. A missed scheduled week breaks WEEKLY.
 *   • Same-day duplicates are collapsed — completing twice counts once.
 *   • "Grace day" support: 1 missed day per 7 consecutive completions doesn't break.
 */

import { parseRRule } from "./recurring";
import type { Habit } from "./types";

const DAY = 86_400_000;

export interface CompletionEntry {
  date: string; // YYYY-MM-DD in habit timezone
  at: number;
  durationMinutes?: number;
  note?: string;
}

export interface StreakResult {
  streak: number;
  longestStreak: number;
  thisWeek: number;
  totalCompletions: number;
  lastCompletedAt?: string;
  /** Used a grace token? */
  graceUsedThisCycle: boolean;
}

/** Re-compute streak from the full completion history. Pure. */
export function computeStreak(habit: Habit, completions: CompletionEntry[], now = Date.now()): StreakResult {
  if (completions.length === 0) {
    return { streak: 0, longestStreak: 0, thisWeek: 0, totalCompletions: 0, graceUsedThisCycle: false };
  }

  // Normalise: one entry per date, sorted descending.
  const byDate = new Map<string, CompletionEntry>();
  for (const c of completions) {
    if (!byDate.has(c.date)) byDate.set(c.date, c);
    else {
      const existing = byDate.get(c.date)!;
      if (c.at > existing.at) byDate.set(c.date, c);
    }
  }
  const sorted = Array.from(byDate.values()).sort((a, b) => b.date.localeCompare(a.date));
  const dates = new Set(sorted.map((c) => c.date));

  const rrule = parseRRule(habit.rrule);
  const isDaily = !rrule || rrule.freq === "DAILY";
  const isWeekly = rrule?.freq === "WEEKLY";

  let streak = 0;
  let graceUsedThisCycle = false;
  if (isDaily) {
    let cursor = startOfDay(now);
    let graceTokens = 0;
    // Each 7 consecutive completions yields 1 grace token.
    while (true) {
      const iso = isoDay(cursor);
      if (dates.has(iso)) {
        streak++;
        if (streak > 0 && streak % 7 === 0) graceTokens++;
      } else if (graceTokens > 0) {
        graceTokens--;
        graceUsedThisCycle = true;
        // Don't break — skip this day with grace.
      } else {
        break;
      }
      cursor -= DAY;
      // Safety: cap walk at 2 years.
      if (streak > 730) break;
    }
  } else if (isWeekly && rrule.byDay) {
    // Each scheduled weekday must be completed in its week.
    let cursor = startOfWeek(now);
    while (true) {
      const required = rrule.byDay;
      let allDone = true;
      for (const day of required) {
        const dayIso = isoDay(cursor + dayIndex(day) * DAY);
        if (!dates.has(dayIso)) { allDone = false; break; }
      }
      if (allDone) streak++;
      else break;
      cursor -= 7 * DAY;
      if (streak > 200) break;
    }
  }

  // Longest streak: scan consecutively over all dates.
  let longestStreak = 0;
  if (isDaily) {
    let run = 0;
    const sortedAsc = Array.from(dates).sort();
    let prev: string | null = null;
    for (const d of sortedAsc) {
      if (prev && new Date(d).getTime() - new Date(prev).getTime() === DAY) run++;
      else run = 1;
      if (run > longestStreak) longestStreak = run;
      prev = d;
    }
  } else {
    longestStreak = streak;
  }

  const thisWeekStart = startOfWeek(now);
  let thisWeek = 0;
  for (const d of dates) {
    const dt = new Date(d).getTime();
    if (dt >= thisWeekStart && dt <= now) thisWeek++;
  }

  return {
    streak,
    longestStreak,
    thisWeek,
    totalCompletions: byDate.size,
    lastCompletedAt: sorted[0]?.date,
    graceUsedThisCycle,
  };
}

/** Returns whether `now` is inside the habit's expected slot today. */
export function isDueNow(habit: Habit, now = Date.now()): boolean {
  const rule = parseRRule(habit.rrule);
  if (!rule) return true;
  const today = new Date(now);
  if (rule.freq === "DAILY") return true;
  if (rule.freq === "WEEKLY" && rule.byDay) {
    const weekdays: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
    return rule.byDay.some((d) => weekdays[d] === today.getDay());
  }
  return true;
}

/** "Should the user see a nudge to complete this today?" */
export function dueButNotCompletedToday(habit: Habit, completions: CompletionEntry[], now = Date.now()): boolean {
  if (!isDueNow(habit, now)) return false;
  const today = isoDay(now);
  return !completions.some((c) => c.date === today);
}

/* ───────────── helpers ───────────── */

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function startOfWeek(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function dayIndex(weekday: string): number {
  const map: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  return map[weekday] ?? 0;
}
