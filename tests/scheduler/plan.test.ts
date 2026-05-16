import { describe, it, expect } from "vitest";
import { plan } from "@/lib/scheduler/plan";
import type { PlanRequest, Task, TimedEvent } from "@/lib/scheduler/types";

const NOW = new Date("2026-05-18T08:00:00.000Z").getTime();

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id, projectId: "p", ownerId: "u",
    title: "Task", kind: "task",
    start: null, end: null,
    energy: "deep", durationMinutes: 60, timeZone: "UTC",
    priority: { score: 0, factors: [] },
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
    priority: { score: 0, factors: [] },
    pinned: false, autoPlaced: false,
    createdAt: 0, updatedAt: 0,
    ...overrides,
  };
}

function request(overrides: Partial<PlanRequest> = {}): PlanRequest {
  return {
    rangeStart: "2026-05-18T08:00:00.000Z",
    rangeEnd:   "2026-05-18T18:00:00.000Z",
    events: [], tasks: [], habits: [], goals: [],
    now: NOW,
    ...overrides,
  };
}

describe("plan", () => {
  it("returns a stable summary for empty input", () => {
    const r = plan(request());
    expect(r.summary).toContain("0 items already in a stable state");
    expect(r.conflicts).toEqual([]);
    expect(r.unscheduled).toEqual([]);
    expect(r.plannedAt).toBe(NOW);
  });

  it("re-runs deterministically (idempotent)", () => {
    const t = task("t1");
    const a = plan(request({ tasks: [t] }));
    const b = plan(request({ tasks: [t] }));
    expect(a.summary).toBe(b.summary);
    expect(a.items.length).toBe(b.items.length);
  });

  it("attaches priority scores to events", () => {
    const r = plan(request({
      events: [event("e1", "2026-05-18T09:00:00.000Z", "2026-05-18T10:00:00.000Z")],
    }));
    const e = r.items.find((i) => i.id === "e1");
    expect(e).toBeDefined();
    expect(e!.priority.score).toBeGreaterThanOrEqual(0);
  });

  it("flags conflicts in the summary when applicable", () => {
    const a = event("a", "2026-05-18T09:00:00.000Z", "2026-05-18T10:00:00.000Z");
    const b = event("b", "2026-05-18T09:30:00.000Z", "2026-05-18T10:30:00.000Z");
    const r = plan(request({ events: [a, b] }));
    expect(r.conflicts.length).toBeGreaterThan(0);
    expect(r.summary).toMatch(/conflict/);
  });

  it("reports overload entries within the range", () => {
    const r = plan(request({
      rangeStart: "2026-05-18T00:00:00.000Z",
      rangeEnd:   "2026-05-20T23:59:59.000Z",
      events: [event("e", "2026-05-18T09:00:00.000Z", "2026-05-18T10:00:00.000Z")],
    }));
    expect(Array.isArray(r.overload)).toBe(true);
  });
});
