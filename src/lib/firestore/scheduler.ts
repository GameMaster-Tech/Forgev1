/**
 * Scheduler — Firestore service.
 *
 * Per-project calendar events, scheduler timed events, tasks,
 * habits, and goals. Paths:
 *
 *   /users/{uid}/projects/{pid}/calendar_events/{eventId}    — CalendarEvent
 *   /users/{uid}/projects/{pid}/scheduler_events/{eventId}   — TimedEvent
 *   /users/{uid}/projects/{pid}/scheduler_tasks/{taskId}     — Task
 *   /users/{uid}/projects/{pid}/scheduler_habits/{habitId}   — Habit
 *   /users/{uid}/projects/{pid}/scheduler_goals/{goalId}     — Goal
 *
 * Two event collections (calendar + scheduler) because the surfaces
 * have different rendering needs:
 *   • CalendarEvent is what the grid displays (Forge + Google events).
 *   • TimedEvent is what Tempo schedules against (energy-tagged
 *     planner items). Some events live in both, keyed by id.
 *
 * All paths fall under the project-subtree wildcard rule.
 */

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { CalendarEvent } from "@/lib/calendar/types";
import type {
  Goal,
  Habit,
  Task,
  TimedEvent,
} from "@/lib/scheduler/types";

const CALENDAR = "calendar_events";
const EVENTS = "scheduler_events";
const TASKS = "scheduler_tasks";
const HABITS = "scheduler_habits";
const GOALS = "scheduler_goals";

interface PathParts {
  uid: string;
  projectId: string;
}

function projectPath({ uid, projectId }: PathParts): string {
  return `users/${uid}/projects/${projectId}`;
}

/**
 * Firestore rejects `undefined` values on write ("Unsupported field
 * value: undefined"). Optional fields on Habit / Goal / Task /
 * TimedEvent / CalendarEvent commonly arrive as undefined, so every
 * upsert below routes its payload through this stripper.
 *
 * Recursion handles nested arrays/objects (e.g. `priority.factors`,
 * `attendees`). `null` is preserved — that's a valid Firestore value
 * and Forge uses it intentionally (e.g. `Task.start = null` for
 * unscheduled tasks).
 */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefined(v)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

/* ───────────── reads ───────────── */

export interface SchedulerPayload {
  calendarEvents: CalendarEvent[];
  events: TimedEvent[];
  tasks: Task[];
  habits: Habit[];
  goals: Goal[];
}

export async function readSchedulerSnapshot(
  p: PathParts,
): Promise<SchedulerPayload> {
  const base = projectPath(p);
  const [cal, events, tasks, habits, goals] = await Promise.all([
    getDocs(collection(db, `${base}/${CALENDAR}`)),
    getDocs(collection(db, `${base}/${EVENTS}`)),
    getDocs(collection(db, `${base}/${TASKS}`)),
    getDocs(collection(db, `${base}/${HABITS}`)),
    getDocs(collection(db, `${base}/${GOALS}`)),
  ]);
  return {
    calendarEvents: cal.docs.map((d) => d.data() as CalendarEvent),
    events: events.docs.map((d) => d.data() as TimedEvent),
    tasks: tasks.docs.map((d) => d.data() as Task),
    habits: habits.docs.map((d) => d.data() as Habit),
    goals: goals.docs.map((d) => d.data() as Goal),
  };
}

/* ───────────── live subscription ───────────── */

export function subscribeScheduler(
  p: PathParts,
  onChange: (payload: SchedulerPayload) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const base = projectPath(p);
  const cache: SchedulerPayload = {
    calendarEvents: [],
    events: [],
    tasks: [],
    habits: [],
    goals: [],
  };
  const emit = () => onChange({ ...cache });
  const handleError = (err: unknown) => onError?.(err);

  const unsubs: Unsubscribe[] = [
    onSnapshot(
      query(collection(db, `${base}/${CALENDAR}`)),
      (snap) => {
        cache.calendarEvents = snap.docs.map((d) => d.data() as CalendarEvent);
        emit();
      },
      handleError,
    ),
    onSnapshot(
      query(collection(db, `${base}/${EVENTS}`)),
      (snap) => {
        cache.events = snap.docs.map((d) => d.data() as TimedEvent);
        emit();
      },
      handleError,
    ),
    onSnapshot(
      query(collection(db, `${base}/${TASKS}`)),
      (snap) => {
        cache.tasks = snap.docs.map((d) => d.data() as Task);
        emit();
      },
      handleError,
    ),
    onSnapshot(
      query(collection(db, `${base}/${HABITS}`)),
      (snap) => {
        cache.habits = snap.docs.map((d) => d.data() as Habit);
        emit();
      },
      handleError,
    ),
    onSnapshot(
      query(collection(db, `${base}/${GOALS}`)),
      (snap) => {
        cache.goals = snap.docs.map((d) => d.data() as Goal);
        emit();
      },
      handleError,
    ),
  ];

  return () => {
    for (const u of unsubs) u();
  };
}

/* ───────────── writes ───────────── */

export async function upsertCalendarEvent(
  p: PathParts,
  event: CalendarEvent,
): Promise<void> {
  await setDoc(
    doc(db, `${projectPath(p)}/${CALENDAR}`, event.id),
    stripUndefined({ ...event, updatedAt: serverTimestamp() }),
    { merge: true },
  );
}

export async function upsertTimedEvent(
  p: PathParts,
  event: TimedEvent,
): Promise<void> {
  await setDoc(
    doc(db, `${projectPath(p)}/${EVENTS}`, event.id),
    stripUndefined({ ...event, updatedAt: serverTimestamp() }),
    { merge: true },
  );
}

export async function upsertTask(p: PathParts, task: Task): Promise<void> {
  await setDoc(
    doc(db, `${projectPath(p)}/${TASKS}`, task.id),
    stripUndefined({ ...task, updatedAt: serverTimestamp() }),
    { merge: true },
  );
}

export async function upsertHabit(p: PathParts, habit: Habit): Promise<void> {
  await setDoc(
    doc(db, `${projectPath(p)}/${HABITS}`, habit.id),
    stripUndefined({ ...habit, updatedAt: serverTimestamp() }),
    { merge: true },
  );
}

export async function upsertGoal(p: PathParts, goal: Goal): Promise<void> {
  await setDoc(
    doc(db, `${projectPath(p)}/${GOALS}`, goal.id),
    stripUndefined({ ...goal, updatedAt: serverTimestamp() }),
    { merge: true },
  );
}
