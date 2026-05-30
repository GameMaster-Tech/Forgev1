"use client";

/**
 * Aria's real entity creators.
 *
 * These build fully-formed records and persist them through the SAME scheduler
 * Firestore service the calendar/Tempo surfaces subscribe to
 * (`/users/{uid}/projects/{pid}/scheduler_*` + `calendar_events`), so a voice
 * "create an event" actually lands in the backend AND shows up live — fixing the
 * old stub that only navigated and lied about success.
 */

import {
  upsertCalendarEvent,
  upsertTask,
  upsertHabit,
  upsertGoal,
} from "@/lib/firestore/scheduler";
import type { CalendarEvent, EventKind } from "@/lib/calendar/types";
import type { Task, Habit, Goal } from "@/lib/scheduler/types";

export interface Owner {
  uid: string;
  projectId: string;
}

function newId(prefix: string): string {
  const rnd =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}_${rnd}`;
}

function tz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/** Next top of the hour, in case the model didn't give a time. */
function defaultStartISO(): string {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.toISOString();
}

function plusMinutesISO(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

export async function createCalendarEvent(
  o: Owner,
  p: { title?: string; start?: string; end?: string; allDay?: boolean; kind?: EventKind; location?: string; description?: string },
): Promise<CalendarEvent> {
  const start = p.start || defaultStartISO();
  const end = p.end || plusMinutesISO(start, 60);
  const event: CalendarEvent = {
    id: newId("evt"),
    projectId: o.projectId,
    title: p.title?.trim() || "New event",
    start,
    end,
    allDay: p.allDay ?? false,
    kind: p.kind ?? "personal",
    source: "forge",
    description: p.description,
    location: p.location,
  };
  await upsertCalendarEvent(o, event);
  return event;
}

export async function createTask(
  o: Owner,
  p: { title?: string; due?: string; durationMinutes?: number },
): Promise<Task> {
  const now = Date.now();
  const task: Task = {
    id: newId("task"),
    projectId: o.projectId,
    ownerId: o.uid,
    title: p.title?.trim() || "New task",
    kind: "task",
    start: null,
    end: null,
    energy: "shallow",
    durationMinutes: p.durationMinutes ?? 30,
    timeZone: tz(),
    priority: { score: 50, factors: [] },
    pinned: false,
    autoPlaced: false,
    due: p.due,
    splittable: true,
    progress: 0,
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
  await upsertTask(o, task);
  return task;
}

export async function createHabit(
  o: Owner,
  p: { title?: string; rrule?: string; durationMinutes?: number },
): Promise<Habit> {
  const habit: Habit = {
    id: newId("habit"),
    projectId: o.projectId,
    ownerId: o.uid,
    title: p.title?.trim() || "New habit",
    rrule: p.rrule || "FREQ=DAILY",
    durationMinutes: p.durationMinutes ?? 20,
    energy: "shallow",
    timeZone: tz(),
    streak: 0,
    createdAt: Date.now(),
  };
  await upsertHabit(o, habit);
  return habit;
}

export async function createGoal(
  o: Owner,
  p: { title?: string; targetDate?: string; successCriteria?: string; weeklyMinutesTarget?: number },
): Promise<Goal> {
  const goal: Goal = {
    id: newId("goal"),
    projectId: o.projectId,
    ownerId: o.uid,
    title: p.title?.trim() || "New goal",
    successCriteria: p.successCriteria,
    targetDate: p.targetDate,
    weeklyMinutesTarget: p.weeklyMinutesTarget ?? 120,
    loggedMinutes: 0,
    status: "active",
    createdAt: Date.now(),
  };
  await upsertGoal(o, goal);
  return goal;
}
