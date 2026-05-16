import { describe, it, expect } from "vitest";
import {
  inferEnergyProfile,
  inferWeeklyCapacity,
  inferMeetingLoadCaps,
  inferProtectedWindows,
  learnRoutine,
} from "@/lib/scheduler/routines";
import type { TimedEvent } from "@/lib/scheduler/types";

const NOW = new Date("2026-05-15T12:00:00.000Z").getTime();
const DAY = 86_400_000;
const HOUR = 3600_000;

function event(start: string, end: string, overrides: Partial<TimedEvent> = {}): TimedEvent {
  return {
    id: `e_${start}`,
    projectId: "p", ownerId: "u",
    title: overrides.title ?? "Meeting",
    kind: "event",
    eventKind: "meeting",
    start,
    end,
    energy: "social",
    durationMinutes: 60,
    timeZone: "UTC",
    priority: { score: 0, factors: [] },
    pinned: false,
    autoPlaced: false,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("inferEnergyProfile", () => {
  it("returns 24 hourly slots", () => {
    expect(inferEnergyProfile([])).toHaveLength(24);
  });

  it("classifies deep work by title", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      event(`2026-05-${10 + i}T10:00:00.000Z`, `2026-05-${10 + i}T11:00:00.000Z`, {
        id: `e${i}`, title: "Deep focus coding",
      }),
    );
    const profile = inferEnergyProfile(events);
    expect(profile[10]).toBe("deep");
  });

  it("classifies social events with ≥4 attendees", () => {
    const events = Array.from({ length: 5 }, (_, i) =>
      event(`2026-05-${10 + i}T14:00:00.000Z`, `2026-05-${10 + i}T15:00:00.000Z`, {
        id: `e${i}`,
        title: "All-hands",
        attendees: [
          { name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" },
        ],
      }),
    );
    const profile = inferEnergyProfile(events);
    expect(profile[14]).toBe("social");
  });
});

describe("inferWeeklyCapacity", () => {
  it("returns 7 entries (one per weekday)", () => {
    expect(inferWeeklyCapacity([])).toHaveLength(7);
  });

  it("uses median of active minutes per weekday", () => {
    const events = [
      // Three Mondays with active windows of 6h, 8h, 10h. Median = 8h = 480.
      event("2026-05-04T09:00:00.000Z", "2026-05-04T15:00:00.000Z"), // 6h
      event("2026-05-11T09:00:00.000Z", "2026-05-11T17:00:00.000Z"), // 8h
      event("2026-05-18T09:00:00.000Z", "2026-05-18T19:00:00.000Z"), // 10h
    ];
    const cap = inferWeeklyCapacity(events);
    expect(cap[1]).toBe(480); // Monday
  });

  it("defaults to 0 minutes for weekend with no data", () => {
    const cap = inferWeeklyCapacity([]);
    expect(cap[0]).toBe(0); // Sunday
    expect(cap[6]).toBe(0); // Saturday
  });
});

describe("inferMeetingLoadCaps", () => {
  it("returns 60% of weekly capacity", () => {
    const events = [
      event("2026-05-11T09:00:00.000Z", "2026-05-11T17:00:00.000Z"), // 8h Mon
    ];
    const caps = inferMeetingLoadCaps(events);
    expect(caps[1]).toBe(Math.round(8 * 60 * 0.6));
  });
});

describe("inferProtectedWindows", () => {
  it("returns [] with less than 4 weeks of data", () => {
    const events = [
      event("2026-05-11T09:00:00.000Z", "2026-05-11T10:00:00.000Z"),
    ];
    expect(inferProtectedWindows(events)).toEqual([]);
  });

  it("emits a weekend protected window when never occupied on weekends", () => {
    // Many weekday events across 5 weeks, but never weekend.
    const events: TimedEvent[] = [];
    for (let w = 0; w < 6; w++) {
      for (let d = 1; d <= 5; d++) {
        const base = new Date(NOW - (6 - w) * 7 * DAY);
        base.setDate(base.getDate() - base.getDay() + d);
        const start = new Date(base);
        start.setHours(10, 0, 0, 0);
        const end = new Date(start.getTime() + HOUR);
        events.push(event(start.toISOString(), end.toISOString(), { id: `e_${w}_${d}` }));
      }
    }
    const pw = inferProtectedWindows(events);
    expect(pw.some((p) => p.reason === "weekend protected")).toBe(true);
  });
});

describe("learnRoutine", () => {
  it("returns a UserRoutine with stable fields", () => {
    const r = learnRoutine({
      events: [event("2026-05-11T09:00:00.000Z", "2026-05-11T10:00:00.000Z")],
      now: NOW,
      timeZone: "America/New_York",
    });
    expect(r.timeZone).toBe("America/New_York");
    expect(r.weeklyCapacityMinutes).toHaveLength(7);
    expect(r.energyProfile).toHaveLength(24);
    expect(r.lastLearnedAt).toBe(NOW);
  });
});
