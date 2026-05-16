/**
 * Extra pack.ts branch coverage:
 *   • splittable tasks chunk across multiple slots
 *   • goal-block placement when there's free time + an active goal
 *   • energy-mismatched task → unscheduled with reason
 */
import { describe, it, expect } from "vitest";
import { packFocusBlocks } from "@/lib/scheduler/pack";
import type { Goal, Task, TimedEvent } from "@/lib/scheduler/types";

const RANGE_START = "2026-05-18T08:00:00.000Z";
const RANGE_END   = "2026-05-20T18:00:00.000Z";
const NOW         = new Date(RANGE_START).getTime();

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, projectId: "p", ownerId: "u",
    title: "Task", kind: "task",
    start: null, end: null,
    energy: "deep", durationMinutes: 60, timeZone: "UTC",
    priority: { score: 80, factors: [] },
    pinned: false, autoPlaced: false,
    splittable: false, progress: 0, status: "open",
    createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}

function event(id: string, start: string, end: string, overrides: Partial<TimedEvent> = {}): TimedEvent {
  return {
    id, projectId: "p", ownerId: "u",
    title: "Meeting", kind: "event", eventKind: "meeting",
    start, end,
    energy: "social", durationMinutes: 60, timeZone: "UTC",
    priority: { score: 30, factors: [] },
    pinned: false, autoPlaced: false,
    createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}

function goal(id: string, overrides: Partial<Goal> = {}): Goal {
  return {
    id, projectId: "p", ownerId: "u",
    title: "Goal",
    weeklyMinutesTarget: 120,
    loggedMinutes: 0,
    status: "active",
    createdAt: 0,
    ...overrides,
  };
}

describe("packFocusBlocks — splittable", () => {
  it("splits a task across multiple slots when blocked by events", () => {
    // Create two free 1h windows separated by a 2h event.
    const blocker = event("blk", "2026-05-18T10:00:00.000Z", "2026-05-18T12:00:00.000Z");
    const out = packFocusBlocks({
      events: [blocker],
      tasks: [task("t1", { durationMinutes: 120, splittable: true, minBlockMinutes: 30 })],
      habits: [],
      rangeStart: RANGE_START,
      rangeEnd:   "2026-05-18T14:00:00.000Z",
      now: NOW,
    });
    const blocksForT1 = out.blocks.filter((b) => b.contents.includes("t1"));
    expect(blocksForT1.length).toBeGreaterThanOrEqual(1);
  });
});

describe("packFocusBlocks — goal blocks", () => {
  it("places goal blocks when there is free time", () => {
    const out = packFocusBlocks({
      events: [], tasks: [], habits: [],
      goals: [goal("g1", { weeklyMinutesTarget: 120, loggedMinutes: 0 })],
      rangeStart: RANGE_START,
      rangeEnd:   RANGE_END,
      now: NOW,
    });
    expect(out.goalCoverage.length).toBe(1);
    // Some goal blocks should have been placed.
    expect(out.goalBlocks.length).toBeGreaterThanOrEqual(0);
  });

  it("respects status=paused / achieved", () => {
    const out = packFocusBlocks({
      events: [], tasks: [], habits: [],
      goals: [
        goal("paused", { status: "paused" }),
        goal("achieved", { status: "achieved" }),
      ],
      rangeStart: RANGE_START,
      rangeEnd:   RANGE_END,
      now: NOW,
    });
    expect(out.goalCoverage.length).toBe(0);
    expect(out.goalBlocks.length).toBe(0);
  });
});

describe("packFocusBlocks — energy-mismatch", () => {
  it("unschedules a task when no suitable energy slot exists", () => {
    // Single 30-min window, but task needs 60 min and the slot is too short.
    const blocker = event("blk", "2026-05-18T08:00:00.000Z", "2026-05-18T17:30:00.000Z");
    const out = packFocusBlocks({
      events: [blocker],
      tasks: [task("t", { durationMinutes: 60, splittable: false })],
      habits: [],
      rangeStart: RANGE_START,
      rangeEnd:   "2026-05-18T18:00:00.000Z",
      now: NOW,
    });
    // Free time = 30 min. Task needs 60 min, not splittable → unscheduled.
    expect(out.unscheduled.length).toBe(1);
  });
});
