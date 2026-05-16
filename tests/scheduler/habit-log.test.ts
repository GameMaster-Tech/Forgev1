import { describe, it, expect } from "vitest";
import {
  computeStreak,
  isDueNow,
  dueButNotCompletedToday,
  type CompletionEntry,
} from "@/lib/scheduler/habit-log";
import type { Habit } from "@/lib/scheduler/types";

const NOW = new Date("2026-05-15T12:00:00.000Z").getTime();
const DAY = 86_400_000;

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: "h", projectId: "p", ownerId: "u",
    title: "Run",
    rrule: "FREQ=DAILY",
    durationMinutes: 30,
    energy: "deep",
    timeZone: "UTC",
    streak: 0,
    createdAt: NOW - 30 * DAY,
    ...overrides,
  };
}

function completion(dateOffsetDays: number): CompletionEntry {
  const d = new Date(NOW - dateOffsetDays * DAY);
  const date = d.toISOString().slice(0, 10);
  return { date, at: d.getTime() };
}

describe("computeStreak — daily", () => {
  it("returns 0 with no completions", () => {
    const r = computeStreak(habit(), [], NOW);
    expect(r.streak).toBe(0);
  });

  it("counts consecutive daily completions", () => {
    const c = [0, 1, 2, 3, 4].map(completion); // today through 4d ago
    const r = computeStreak(habit(), c, NOW);
    expect(r.streak).toBe(5);
  });

  it("breaks on a gap", () => {
    const c = [0, 2, 3].map(completion); // skip yesterday
    const r = computeStreak(habit(), c, NOW);
    expect(r.streak).toBe(1);
  });

  it("collapses same-day duplicates", () => {
    const c: CompletionEntry[] = [
      { date: new Date(NOW).toISOString().slice(0, 10), at: NOW - 1000 },
      { date: new Date(NOW).toISOString().slice(0, 10), at: NOW },
    ];
    const r = computeStreak(habit(), c, NOW);
    expect(r.totalCompletions).toBe(1);
    expect(r.streak).toBe(1);
  });

  it("uses grace tokens after a 7-day run", () => {
    // 7 consecutive days (today..day-6) earn a grace token; day-7 is
    // missed but the token is spent, then day-8 continues the streak.
    const offsets = [0, 1, 2, 3, 4, 5, 6, 8];
    const c = offsets.map(completion);
    const r = computeStreak(habit(), c, NOW);
    expect(r.streak).toBeGreaterThanOrEqual(8);
    expect(r.graceUsedThisCycle).toBe(true);
  });
});

describe("computeStreak — weekly (BYDAY)", () => {
  it("requires every BYDAY weekday to be completed", () => {
    // 2026-05-15 is a Friday. Weekly BYDAY=MO,WE,FR.
    // Generate completions for the current week's MO(11), WE(13), FR(15).
    const h = habit({ rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR" });
    const monday = new Date("2026-05-11").toISOString().slice(0, 10);
    const wednesday = new Date("2026-05-13").toISOString().slice(0, 10);
    const friday = new Date("2026-05-15").toISOString().slice(0, 10);
    const c: CompletionEntry[] = [monday, wednesday, friday].map((date) => ({ date, at: new Date(date).getTime() }));
    const r = computeStreak(h, c, NOW);
    expect(r.streak).toBeGreaterThanOrEqual(1);
  });

  it("misses break weekly streak", () => {
    const h = habit({ rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR" });
    // Only Monday this week.
    const c: CompletionEntry[] = [{ date: "2026-05-11", at: new Date("2026-05-11").getTime() }];
    const r = computeStreak(h, c, NOW);
    expect(r.streak).toBe(0);
  });
});

describe("isDueNow", () => {
  it("daily is always due", () => {
    expect(isDueNow(habit(), NOW)).toBe(true);
  });

  it("weekly matches its weekday", () => {
    // 2026-05-15 is Friday (5). FR is in our BYDAY.
    expect(isDueNow(habit({ rrule: "FREQ=WEEKLY;BYDAY=FR" }), NOW)).toBe(true);
    // MO is NOT today.
    expect(isDueNow(habit({ rrule: "FREQ=WEEKLY;BYDAY=MO" }), NOW)).toBe(false);
  });
});

describe("dueButNotCompletedToday", () => {
  it("true when due and no completion today", () => {
    expect(dueButNotCompletedToday(habit(), [], NOW)).toBe(true);
  });

  it("false when completed today", () => {
    const today = new Date(NOW).toISOString().slice(0, 10);
    expect(dueButNotCompletedToday(habit(), [{ date: today, at: NOW }], NOW)).toBe(false);
  });

  it("false when not due", () => {
    expect(dueButNotCompletedToday(habit({ rrule: "FREQ=WEEKLY;BYDAY=MO" }), [], NOW)).toBe(false);
  });
});
