import { describe, it, expect } from "vitest";
import {
  scorePriority,
  scoreAll,
  topN,
  urgencyByDay,
  PRIORITY_WEIGHTS,
  type PriorityContext,
} from "@/lib/scheduler/priority";
import type {
  Goal,
  PriorityScore,
  ScheduleItem,
  Task,
  TimedEvent,
} from "@/lib/scheduler/types";
import type { Assertion } from "@/lib/sync/types";

const NOW = new Date("2026-05-15T12:00:00.000Z").getTime();
const HOUR = 3600_000;
const DAY = 86_400_000;

const emptyScore: PriorityScore = { score: 0, factors: [] };

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "t1",
    projectId: "p1",
    ownerId: "u1",
    title: "Write spec",
    kind: "task",
    start: null,
    end: null,
    energy: "deep",
    durationMinutes: 60,
    timeZone: "UTC",
    priority: emptyScore,
    pinned: false,
    autoPlaced: false,
    splittable: true,
    progress: 0,
    status: "open",
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
    ...overrides,
  };
}

function event(overrides: Partial<TimedEvent> = {}): TimedEvent {
  return {
    id: "e1",
    projectId: "p1",
    ownerId: "u1",
    title: "Stand-up",
    kind: "event",
    eventKind: "meeting",
    start: new Date(NOW).toISOString(),
    end: new Date(NOW + HOUR).toISOString(),
    energy: "social",
    durationMinutes: 60,
    timeZone: "UTC",
    priority: emptyScore,
    pinned: false,
    autoPlaced: false,
    createdAt: NOW - DAY,
    updatedAt: NOW - DAY,
    ...overrides,
  };
}

describe("deadline-proximity factor", () => {
  it("zero contribution when no due date", () => {
    const t = task({ due: undefined });
    const r = scorePriority(t, { now: NOW });
    expect(r.factors.find((f) => f.kind === "deadline-proximity")).toBeUndefined();
  });

  it("max contribution when overdue", () => {
    const t = task({ due: new Date(NOW - 5 * HOUR).toISOString() });
    const r = scorePriority(t, { now: NOW });
    const f = r.factors.find((ff) => ff.kind === "deadline-proximity")!;
    expect(f.contribution).toBe(PRIORITY_WEIGHTS.deadlineMax);
  });

  it("higher when closer to due", () => {
    const near = scorePriority(task({ due: new Date(NOW + HOUR).toISOString() }), { now: NOW });
    const far = scorePriority(task({ due: new Date(NOW + 7 * DAY).toISOString() }), { now: NOW });
    expect(near.score).toBeGreaterThan(far.score);
  });

  it("uses event end as soft deadline", () => {
    const e = event({ end: new Date(NOW + HOUR).toISOString() });
    const r = scorePriority(e, { now: NOW });
    expect(r.factors.some((f) => f.kind === "deadline-proximity")).toBe(true);
  });
});

describe("decay-urgency factor", () => {
  it("noop with no bound keys", () => {
    const t = task({ boundAssertionKeys: undefined });
    const r = scorePriority(t, { now: NOW, assertions: [] });
    expect(r.factors.find((f) => f.kind === "decay-urgency")).toBeUndefined();
  });

  it("contributes when bound assertion is stale", () => {
    const stale: Assertion = {
      id: "a1",
      projectId: "p1",
      documentId: "d1",
      key: "engineering.senior.salary",
      label: "Senior salary",
      kind: "salary.annual",
      value: { type: "number", value: 165_000, unit: "USD" },
      sourcedAt: NOW - 365 * DAY, // 1 year stale
      confidence: 0.6,
    };
    const r = scorePriority(
      task({ boundAssertionKeys: ["engineering.senior.salary"] }),
      { now: NOW, assertions: [stale] },
    );
    const f = r.factors.find((ff) => ff.kind === "decay-urgency");
    expect(f).toBeDefined();
    expect(f!.contribution).toBeGreaterThan(0);
  });

  it("caps cumulative decay contribution at decayMax", () => {
    const make = (key: string): Assertion => ({
      id: key,
      projectId: "p1",
      documentId: "d1",
      key,
      label: key,
      kind: "fact.numeric",
      value: { type: "number", value: 1 },
      sourcedAt: NOW - 1000 * DAY,
      confidence: 0.1,
    });
    const r = scorePriority(
      task({ boundAssertionKeys: ["a", "b", "c", "d"] }),
      { now: NOW, assertions: ["a", "b", "c", "d"].map(make) },
    );
    const total = r.factors
      .filter((f) => f.kind === "decay-urgency")
      .reduce((acc, f) => acc + f.contribution, 0);
    expect(total).toBeLessThanOrEqual(PRIORITY_WEIGHTS.decayMax + 0.01);
  });
});

describe("goal-gravity factor", () => {
  it("noop without goalId", () => {
    const r = scorePriority(task(), { now: NOW });
    expect(r.factors.find((f) => f.kind === "goal-gravity")).toBeUndefined();
  });

  it("under-filled goal pulls harder", () => {
    const goalUnder: Goal = {
      id: "g1", projectId: "p1", ownerId: "u1", title: "Ship beta",
      weeklyMinutesTarget: 600, loggedMinutes: 120, status: "active", createdAt: NOW - 7 * DAY,
    };
    const goalAtCap: Goal = { ...goalUnder, loggedMinutes: 600 };

    const under = scorePriority(task({ boundGoalId: "g1" }), { now: NOW, goals: [goalUnder] });
    const cap = scorePriority(task({ boundGoalId: "g1" }), { now: NOW, goals: [goalAtCap] });

    expect(under.score).toBeGreaterThan(cap.score);
  });

  it("ignores non-active goals", () => {
    const g: Goal = {
      id: "g1", projectId: "p1", ownerId: "u1", title: "Old",
      weeklyMinutesTarget: 100, loggedMinutes: 0, status: "paused", createdAt: NOW,
    };
    const r = scorePriority(task({ boundGoalId: "g1" }), { now: NOW, goals: [g] });
    expect(r.factors.find((f) => f.kind === "goal-gravity")).toBeUndefined();
  });
});

describe("habit-streak factor", () => {
  it("zero with no streak", () => {
    const r = scorePriority(task(), { now: NOW });
    expect(r.factors.find((f) => f.kind === "habit-streak")).toBeUndefined();
  });

  it("non-task/event items get no streak contribution", () => {
    const fb: ScheduleItem = {
      ...event(), kind: "focus-block", contents: [],
    } as unknown as ScheduleItem;
    const r = scorePriority(fb, { now: NOW, habitStreak: 30 });
    expect(r.factors.find((f) => f.kind === "habit-streak")).toBeUndefined();
  });

  it("streak ≥ 14 saturates", () => {
    const r = scorePriority(task(), { now: NOW, habitStreak: 30 });
    const f = r.factors.find((ff) => ff.kind === "habit-streak");
    expect(f!.contribution).toBe(PRIORITY_WEIGHTS.habitStreakMax);
  });

  it("smaller streaks ramp up", () => {
    const seven = scorePriority(task(), { now: NOW, habitStreak: 7 });
    const fourteen = scorePriority(task(), { now: NOW, habitStreak: 14 });
    const sf = seven.factors.find((f) => f.kind === "habit-streak")!;
    const ff = fourteen.factors.find((f) => f.kind === "habit-streak")!;
    expect(sf.contribution).toBeLessThan(ff.contribution);
  });
});

describe("user-pin factor", () => {
  it("contributes userPin weight when pinned", () => {
    const r = scorePriority(task({ pinned: true }), { now: NOW });
    const f = r.factors.find((ff) => ff.kind === "user-pin")!;
    expect(f.contribution).toBe(PRIORITY_WEIGHTS.userPin);
  });
});

describe("score clamp", () => {
  it("never exceeds 100", () => {
    const ctx: PriorityContext = {
      now: NOW,
      assertions: [
        { id: "a", projectId: "p", documentId: "d", key: "x", label: "x", kind: "fact.numeric", value: { type: "number", value: 1 }, sourcedAt: 0, confidence: 0 },
      ],
      goals: [{ id: "g", projectId: "p", ownerId: "u", title: "g", weeklyMinutesTarget: 100, loggedMinutes: 0, status: "active", createdAt: 0 }],
      habitStreak: 100,
    };
    const r = scorePriority(
      task({ due: new Date(NOW - 10 * DAY).toISOString(), pinned: true, boundAssertionKeys: ["x"], boundGoalId: "g" }),
      ctx,
    );
    expect(r.score).toBeLessThanOrEqual(100);
  });

  it("never below 0", () => {
    const r = scorePriority(task(), { now: NOW });
    expect(r.score).toBeGreaterThanOrEqual(0);
  });
});

describe("scoreAll + topN + urgencyByDay", () => {
  it("scoreAll attaches a score to each item", () => {
    const items = [task({ id: "a" }), task({ id: "b", pinned: true })];
    const scored = scoreAll(items, { now: NOW });
    expect(scored[0].priority.score).toBeGreaterThanOrEqual(0);
    expect(scored[1].priority.score).toBeGreaterThan(scored[0].priority.score);
  });

  it("topN filters by threshold and sorts desc", () => {
    const items: Task[] = [
      { ...task({ id: "a" }), priority: { score: 30, factors: [] } },
      { ...task({ id: "b" }), priority: { score: 90, factors: [] } },
      { ...task({ id: "c" }), priority: { score: 55, factors: [] } },
    ];
    const top = topN(items, 5, 40);
    expect(top.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("urgencyByDay buckets by ISO date", () => {
    const items: ScheduleItem[] = [
      { ...task({ id: "a", due: "2026-05-15T10:00:00.000Z" }), priority: { score: 50, factors: [] }, start: "2026-05-15T10:00:00.000Z" },
      { ...task({ id: "b", due: "2026-05-15T18:00:00.000Z" }), priority: { score: 25, factors: [] }, start: "2026-05-15T18:00:00.000Z" },
    ];
    const out = urgencyByDay(items);
    const day = out.find((b) => b.date === "2026-05-15");
    expect(day?.total).toBe(75);
  });
});
