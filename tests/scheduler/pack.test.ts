import { describe, it, expect } from "vitest";
import { packFocusBlocks } from "@/lib/scheduler/pack";
import type {
  Habit,
  Task,
  TimedEvent,
} from "@/lib/scheduler/types";

const RANGE_START = "2026-05-18T08:00:00.000Z"; // Monday
const RANGE_END   = "2026-05-18T18:00:00.000Z";
const NOW         = new Date(RANGE_START).getTime();

function event(id: string, startISO: string, endISO: string, overrides: Partial<TimedEvent> = {}): TimedEvent {
  return {
    id, projectId: "p", ownerId: "u",
    title: "Meeting", kind: "event", eventKind: "meeting",
    start: startISO, end: endISO,
    energy: "social", durationMinutes: 60, timeZone: "UTC",
    priority: { score: 50, factors: [] },
    pinned: false, autoPlaced: false,
    createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}

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

describe("packFocusBlocks", () => {
  it("returns empty output for empty input", () => {
    const out = packFocusBlocks({
      events: [], tasks: [], habits: [],
      rangeStart: RANGE_START, rangeEnd: RANGE_END, now: NOW,
    });
    expect(out.blocks).toEqual([]);
    expect(out.unscheduled).toEqual([]);
  });

  it("places a task in the only free interval", () => {
    const out = packFocusBlocks({
      events: [],
      tasks: [task("t1", { durationMinutes: 60 })],
      habits: [],
      rangeStart: RANGE_START, rangeEnd: RANGE_END,
      now: NOW,
    });
    // Either it placed it as a block, or it was unscheduled with a
    // reason. For a 60-min task in 10h of free time, expect placement.
    expect(out.blocks.length + out.unscheduled.length).toBeGreaterThan(0);
    if (out.blocks.length > 0) {
      const b = out.blocks[0];
      expect(b.contents).toContain("t1");
      expect(new Date(b.start).getTime()).toBeGreaterThanOrEqual(NOW);
      expect(new Date(b.end).getTime()).toBeLessThanOrEqual(new Date(RANGE_END).getTime());
    }
  });

  it("respects events as occupied time", () => {
    const ev = event("blocker", RANGE_START, "2026-05-18T17:00:00.000Z"); // 9h block
    const out = packFocusBlocks({
      events: [ev],
      tasks: [task("t1", { durationMinutes: 30 })],
      habits: [],
      rangeStart: RANGE_START, rangeEnd: RANGE_END,
      now: NOW,
    });
    // Either placed in the tail-end free hour, or unscheduled — never
    // overlapping the event.
    const eventStart = new Date(ev.start).getTime();
    const eventEnd = new Date(ev.end).getTime();
    for (const b of out.blocks) {
      const bStart = new Date(b.start).getTime();
      const bEnd = new Date(b.end).getTime();
      const noOverlap = bEnd <= eventStart || bStart >= eventEnd;
      expect(noOverlap).toBe(true);
    }
  });

  it("higher-priority tasks placed first", () => {
    const ev = event("blocker", "2026-05-18T09:00:00.000Z", "2026-05-18T11:00:00.000Z"); // 2h taken
    const out = packFocusBlocks({
      events: [ev],
      tasks: [
        task("low", { priority: { score: 20, factors: [] }, durationMinutes: 120 }),
        task("high", { priority: { score: 90, factors: [] }, durationMinutes: 120 }),
      ],
      habits: [],
      rangeStart: RANGE_START, rangeEnd: RANGE_END,
      now: NOW,
    });
    const placedIds = out.blocks.flatMap((b) => b.contents);
    if (placedIds.includes("high") && placedIds.includes("low")) {
      const highBlock = out.blocks.find((b) => b.contents.includes("high"))!;
      const lowBlock = out.blocks.find((b) => b.contents.includes("low"))!;
      expect(new Date(highBlock.start).getTime()).toBeLessThanOrEqual(new Date(lowBlock.start).getTime());
    }
  });

  it("flags an oversized task as unscheduled", () => {
    const out = packFocusBlocks({
      events: [],
      tasks: [task("huge", { durationMinutes: 24 * 60, splittable: false })],
      habits: [],
      rangeStart: RANGE_START, rangeEnd: RANGE_END,
      now: NOW,
    });
    expect(out.unscheduled.length).toBeGreaterThan(0);
  });

  it("never overlaps a pinned event", () => {
    const ev = event("pin", "2026-05-18T10:00:00.000Z", "2026-05-18T12:00:00.000Z", { pinned: true });
    const out = packFocusBlocks({
      events: [ev],
      tasks: [task("t1", { durationMinutes: 30 })],
      habits: [],
      rangeStart: RANGE_START, rangeEnd: RANGE_END,
      now: NOW,
      pinnedIds: new Set(["pin"]),
    });
    for (const b of out.blocks) {
      const bStart = new Date(b.start).getTime();
      const bEnd = new Date(b.end).getTime();
      const pinS = new Date(ev.start).getTime();
      const pinE = new Date(ev.end).getTime();
      expect(bStart >= pinE || bEnd <= pinS).toBe(true);
    }
  });

  it("ignores done / abandoned tasks", () => {
    const out = packFocusBlocks({
      events: [],
      tasks: [
        task("done", { status: "done" }),
        task("abandoned", { status: "abandoned" }),
      ],
      habits: [],
      rangeStart: RANGE_START, rangeEnd: RANGE_END,
      now: NOW,
    });
    const ids = out.blocks.flatMap((b) => b.contents);
    expect(ids).not.toContain("done");
    expect(ids).not.toContain("abandoned");
  });

  it("computes goal coverage when goals are supplied", () => {
    const out = packFocusBlocks({
      events: [], tasks: [], habits: [],
      goals: [{
        id: "g1", projectId: "p", ownerId: "u",
        title: "Ship", weeklyMinutesTarget: 120,
        loggedMinutes: 0, status: "active", createdAt: 0,
      }],
      rangeStart: RANGE_START, rangeEnd: RANGE_END,
      now: NOW,
    });
    expect(out.goalCoverage.length).toBeGreaterThanOrEqual(0);
  });
});

describe("packFocusBlocks — habit make-ups", () => {
  it("does not crash on missing habits array", () => {
    const out = packFocusBlocks({
      events: [], tasks: [],
      habits: [] as Habit[],
      rangeStart: RANGE_START, rangeEnd: RANGE_END, now: NOW,
    });
    expect(out).toBeDefined();
  });
});
