import { describe, it, expect } from "vitest";
import {
  detectConflicts,
  detectTimezoneMismatches,
  detectHabitCollisions,
  predictOverload,
  CONFLICT_LABELS,
} from "@/lib/scheduler/conflict";
import type { Habit, Task, TimedEvent, UserRoutine } from "@/lib/scheduler/types";

const NOW = new Date("2026-05-15T10:00:00.000Z").getTime();
const HOUR = 3600_000;

function event(overrides: Partial<TimedEvent>): TimedEvent {
  return {
    id: overrides.id ?? "e",
    projectId: "p1",
    ownerId: "u1",
    title: "Meeting",
    kind: "event",
    eventKind: "meeting",
    start: new Date(NOW).toISOString(),
    end: new Date(NOW + HOUR).toISOString(),
    energy: "social",
    durationMinutes: 60,
    timeZone: "UTC",
    priority: { score: 50, factors: [] },
    pinned: false,
    autoPlaced: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function task(overrides: Partial<Task>): Task {
  return {
    id: overrides.id ?? "t",
    projectId: "p1",
    ownerId: "u1",
    title: "Task",
    kind: "task",
    start: null,
    end: null,
    energy: "deep",
    durationMinutes: 60,
    timeZone: "UTC",
    priority: { score: 30, factors: [] },
    pinned: false,
    autoPlaced: false,
    splittable: true,
    progress: 0,
    status: "open",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("detectConflicts — time-overlap", () => {
  it("flags overlapping events", () => {
    const a = event({ id: "a", start: new Date(NOW).toISOString(), end: new Date(NOW + HOUR).toISOString() });
    const b = event({ id: "b", start: new Date(NOW + 30 * 60_000).toISOString(), end: new Date(NOW + 2 * HOUR).toISOString() });
    const cs = detectConflicts([a, b], { now: NOW });
    expect(cs.some((c) => c.kind === "time-overlap" && c.itemIds.includes("a") && c.itemIds.includes("b"))).toBe(true);
  });

  it("does not flag back-to-back events (B starts when A ends)", () => {
    const a = event({ id: "a", start: new Date(NOW).toISOString(), end: new Date(NOW + HOUR).toISOString() });
    const b = event({ id: "b", start: new Date(NOW + HOUR).toISOString(), end: new Date(NOW + 2 * HOUR).toISOString() });
    const cs = detectConflicts([a, b], { now: NOW });
    expect(cs.find((c) => c.kind === "time-overlap")).toBeUndefined();
  });

  it("suggests moving the lower-priority item", () => {
    const a = event({ id: "a", priority: { score: 80, factors: [] } });
    const b = event({ id: "b", start: new Date(NOW + 30 * 60_000).toISOString(), end: new Date(NOW + 90 * 60_000).toISOString(), priority: { score: 20, factors: [] } });
    const cs = detectConflicts([a, b], { now: NOW });
    const overlap = cs.find((c) => c.kind === "time-overlap")!;
    expect(overlap.suggestion).toContain("Meeting");
  });

  it("suggests moving the non-pinned item when one is pinned", () => {
    const a = event({ id: "a", pinned: true, title: "Locked" });
    const b = event({ id: "b", title: "Open", start: new Date(NOW + 30 * 60_000).toISOString(), end: new Date(NOW + 90 * 60_000).toISOString() });
    const cs = detectConflicts([a, b], { now: NOW });
    const overlap = cs.find((c) => c.kind === "time-overlap")!;
    expect(overlap.suggestion).toContain("Open");
  });
});

describe("detectConflicts — double-booking", () => {
  it("flags two events with a shared accepted attendee", () => {
    const a = event({ id: "a", attendees: [{ name: "Alice", email: "a@x.com", rsvp: "accepted" }] });
    const b = event({
      id: "b",
      start: new Date(NOW + 30 * 60_000).toISOString(),
      end: new Date(NOW + 90 * 60_000).toISOString(),
      attendees: [{ name: "Alice", email: "a@x.com", rsvp: "accepted" }],
    });
    const cs = detectConflicts([a, b], { now: NOW });
    expect(cs.some((c) => c.kind === "double-booking")).toBe(true);
  });

  it("ignores declined attendees", () => {
    const a = event({ id: "a", attendees: [{ name: "Alice", email: "a@x.com", rsvp: "accepted" }] });
    const b = event({
      id: "b",
      start: new Date(NOW + 30 * 60_000).toISOString(),
      end: new Date(NOW + 90 * 60_000).toISOString(),
      attendees: [{ name: "Alice", email: "a@x.com", rsvp: "declined" }],
    });
    const cs = detectConflicts([a, b], { now: NOW });
    expect(cs.find((c) => c.kind === "double-booking")).toBeUndefined();
  });
});

describe("detectConflicts — deadline-impossible", () => {
  it("flags when remaining work > free budget", () => {
    const t = task({
      id: "t",
      due: new Date(NOW + 4 * HOUR).toISOString(),
      durationMinutes: 24 * 60,
      progress: 0,
    });
    const cs = detectConflicts([t], { now: NOW });
    expect(cs.some((c) => c.kind === "deadline-impossible")).toBe(true);
  });

  it("ignores done tasks", () => {
    const t = task({ id: "t", due: new Date(NOW - HOUR).toISOString(), status: "done" });
    const cs = detectConflicts([t], { now: NOW });
    expect(cs.find((c) => c.kind === "deadline-impossible")).toBeUndefined();
  });
});

describe("detectTimezoneMismatches", () => {
  it("flags events spanning ≥5 unique domains", () => {
    const e = event({
      attendees: [
        { name: "A", email: "a@x.com" }, { name: "B", email: "b@y.com" },
        { name: "C", email: "c@z.com" }, { name: "D", email: "d@a.io" },
        { name: "E", email: "e@b.io" },
      ],
    });
    expect(detectTimezoneMismatches([e]).length).toBe(1);
  });

  it("ignores single-domain events", () => {
    const e = event({
      attendees: [
        { name: "A", email: "a@x.com" }, { name: "B", email: "b@x.com" },
      ],
    });
    expect(detectTimezoneMismatches([e]).length).toBe(0);
  });
});

describe("detectHabitCollisions", () => {
  it("flags a daily habit not logged in >2d", () => {
    const h: Habit = {
      id: "h", projectId: "p", ownerId: "u", title: "Run",
      rrule: "FREQ=DAILY", durationMinutes: 30, energy: "deep", timeZone: "UTC",
      streak: 5, lastCompletedAt: new Date(NOW - 4 * 86_400_000).toISOString(),
      createdAt: NOW - 10 * 86_400_000,
    };
    const out = detectHabitCollisions([], [h], { now: NOW });
    expect(out.length).toBe(1);
    expect(out[0].kind).toBe("habit-collision");
  });

  it("ignores archived habits", () => {
    const h: Habit = {
      id: "h", projectId: "p", ownerId: "u", title: "Run",
      rrule: "FREQ=DAILY", durationMinutes: 30, energy: "deep", timeZone: "UTC",
      streak: 5, lastCompletedAt: new Date(NOW - 5 * 86_400_000).toISOString(),
      createdAt: NOW - 10 * 86_400_000, archivedAt: NOW - 86_400_000,
    };
    expect(detectHabitCollisions([], [h], { now: NOW }).length).toBe(0);
  });
});

describe("predictOverload", () => {
  it("returns one record per day", () => {
    const routine: UserRoutine = {
      id: "r", ownerId: "u",
      energyProfile: ["deep", "deep", "deep", "shallow", "social", "rest", "rest", "rest", "deep", "deep", "deep", "deep", "rest", "rest", "shallow", "shallow", "shallow", "social", "rest", "rest", "rest", "rest", "rest", "rest"],
      weeklyCapacityMinutes: [0, 8 * 60, 8 * 60, 8 * 60, 8 * 60, 8 * 60, 0],
      meetingLoadCapsMinutes: [0, 240, 240, 240, 240, 240, 0],
      protectedWindows: [],
      timeZone: "UTC",
      lastLearnedAt: NOW,
    };
    const items = [
      event({ id: "1", start: new Date(NOW).toISOString(), end: new Date(NOW + HOUR).toISOString() }),
    ];
    const out = predictOverload(items, routine, new Date(NOW).toISOString(), new Date(NOW + 3 * 86_400_000).toISOString());
    expect(out.length).toBe(4);
  });

  it("returns empty for invalid range", () => {
    expect(predictOverload([], undefined, "2026-05-15T00:00:00Z", "2026-05-15T00:00:00Z")).toEqual([]);
  });
});

describe("CONFLICT_LABELS", () => {
  it("covers every conflict kind", () => {
    const kinds: Array<keyof typeof CONFLICT_LABELS> = [
      "time-overlap", "deadline-impossible", "energy-mismatch", "overload",
      "double-booking", "sync-constraint", "tz-mismatch", "habit-collision",
    ];
    for (const k of kinds) expect(CONFLICT_LABELS[k]).toBeTruthy();
  });
});
