/**
 * Demo fixture — a realistic founder/IC week for the Tempo tab to chew
 * on out of the box. 24 events, 8 tasks, 3 habits, 2 goals.
 */

import { scoreAll } from "./priority";
import { learnRoutine } from "./routines";
import type { Goal, Habit, Task, TimedEvent } from "./types";

const NOW = Date.now();
const DAY = 86_400_000;
const HOUR = 3600_000;
const MIN = 60_000;

const OWNER = "self";
const TZ = "America/New_York";

let id = 1;
const next = (p: string) => `${p}_${(id++).toString(36)}`;

function meeting(daysFromNow: number, hour: number, durMin: number, title: string, attendees: string[] = []): TimedEvent {
  const start = startOfDay(NOW + daysFromNow * DAY) + hour * HOUR;
  return {
    id: next("e"),
    projectId: "demo-project",
    ownerId: OWNER,
    title,
    kind: "event",
    eventKind: "meeting",
    start: new Date(start).toISOString(),
    end:   new Date(start + durMin * MIN).toISOString(),
    energy: attendees.length > 3 ? "social" : "shallow",
    durationMinutes: durMin,
    timeZone: TZ,
    priority: { score: 0, factors: [] },
    pinned: true,
    autoPlaced: false,
    attendees: attendees.map((name) => ({ name, rsvp: "accepted" })),
    externalSource: "google",
    createdAt: NOW, updatedAt: NOW,
  };
}

function task(daysFromNow: number, hours: number, title: string, energy: Task["energy"], priorityHint: number, projectKey?: string): Task {
  return {
    id: next("t"),
    projectId: "demo-project",
    ownerId: OWNER,
    title,
    kind: "task",
    start: null, end: null,
    energy,
    durationMinutes: hours * 60,
    timeZone: TZ,
    priority: { score: priorityHint, factors: [] },
    pinned: false, autoPlaced: false,
    due: new Date(NOW + daysFromNow * DAY).toISOString(),
    splittable: hours > 1,
    minBlockMinutes: 45,
    progress: 0,
    status: "open",
    boundAssertionKeys: projectKey ? [projectKey] : undefined,
    createdAt: NOW, updatedAt: NOW,
  };
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface DemoBundle {
  events: TimedEvent[];
  tasks: Task[];
  habits: Habit[];
  goals: Goal[];
}

export function buildDemoSchedule(): DemoBundle {
  const events: TimedEvent[] = [
    // Monday
    meeting(1, 9,  30, "Weekly standup", ["Maya", "Priya", "Sam", "Lee"]),
    meeting(1, 10, 60, "1:1 with Maya", ["Maya"]),
    meeting(1, 14, 45, "Customer demo · Acme", ["Acme PM", "Acme SE"]),
    meeting(1, 16, 60, "Roadmap review", ["Maya", "Priya"]),
    // Tuesday
    meeting(2, 9,  30, "Standup", ["Maya", "Priya", "Sam", "Lee"]),
    meeting(2, 11, 45, "Investor sync · Lyra Capital", ["Lyra GP", "Lyra Associate"]),
    meeting(2, 15, 30, "Hiring debrief", ["Priya"]),
    // Wednesday
    meeting(3, 9,  30, "Standup"),
    meeting(3, 13, 90, "Strategy offsite prep", ["Maya", "Priya", "Sam"]),
    meeting(3, 17, 30, "Therapy"),
    // Thursday
    meeting(4, 9,  30, "Standup"),
    meeting(4, 10, 60, "Board call", ["Anders", "Renu", "Maya"]),
    meeting(4, 14, 45, "Product critique"),
    // Friday
    meeting(5, 9,  30, "Standup"),
    meeting(5, 11, 30, "1:1 with Priya", ["Priya"]),
    meeting(5, 16, 60, "Friday demo + retro", ["Maya", "Priya", "Sam", "Lee", "Charlotte"]),
  ];

  const tasks: Task[] = [
    task(2, 3,   "Draft Q3 board pre-read",          "deep",     78, "engineering.senior.salary"),
    task(3, 2,   "Update investor-update doc",       "creative", 58),
    task(1, 1.5, "Review Sam's hiring plan PR",      "shallow",  48),
    task(4, 4,   "Write Tempo launch announcement",  "deep",     65),
    task(5, 1,   "Renew domain registrations",       "shallow",  32),
    task(2, 1.5, "Plan offsite agenda",              "shallow",  44),
    task(7, 6,   "Refactor verification pipeline",   "deep",     71),
    task(3, 2,   "Customer call notes synthesis",    "creative", 55),
  ];

  const habits: Habit[] = [
    {
      id: next("h"),
      projectId: null, ownerId: OWNER,
      title: "Morning workout",
      rrule: "FREQ=DAILY",
      durationMinutes: 45,
      energy: "rest",
      timeZone: TZ,
      streak: 14,
      lastCompletedAt: new Date(NOW - DAY).toISOString(),
      createdAt: NOW - 30 * DAY,
    },
    {
      id: next("h"),
      projectId: null, ownerId: OWNER,
      title: "Weekly review",
      rrule: "FREQ=WEEKLY;BYDAY=FR",
      durationMinutes: 30,
      energy: "shallow",
      timeZone: TZ,
      streak: 6,
      lastCompletedAt: new Date(NOW - 7 * DAY).toISOString(),
      createdAt: NOW - 60 * DAY,
    },
    {
      id: next("h"),
      projectId: null, ownerId: OWNER,
      title: "Read 30 pages",
      rrule: "FREQ=DAILY",
      durationMinutes: 30,
      energy: "creative",
      timeZone: TZ,
      streak: 3,
      lastCompletedAt: new Date(NOW - 2 * DAY).toISOString(),
      createdAt: NOW - 14 * DAY,
    },
  ];

  const goals: Goal[] = [
    {
      id: next("g"),
      projectId: "demo-project", ownerId: OWNER,
      title: "Ship Tempo v0.1",
      description: "Production-grade AI scheduler that beats Motion on explainability.",
      targetDate: new Date(NOW + 45 * DAY).toISOString(),
      weeklyMinutesTarget: 12 * 60,
      loggedMinutes: 7 * 60,
      status: "active",
      createdAt: NOW - 14 * DAY,
    },
    {
      id: next("g"),
      projectId: "demo-project", ownerId: OWNER,
      title: "Close $5M seed extension",
      targetDate: new Date(NOW + 75 * DAY).toISOString(),
      weeklyMinutesTarget: 6 * 60,
      loggedMinutes: 2.5 * 60,
      status: "active",
      createdAt: NOW - 30 * DAY,
    },
  ];

  // Score tasks once so the UI has data to render before plan().
  const ctx = { goals, now: NOW };
  const scoredTasks = scoreAll(tasks, ctx);

  return { events, tasks: scoredTasks, habits, goals };
}

export function buildDemoRoutine(events: TimedEvent[]) {
  return learnRoutine({ events, now: NOW, timeZone: TZ });
}
