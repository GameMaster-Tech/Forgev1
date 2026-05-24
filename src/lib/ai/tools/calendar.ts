/**
 * Calendar / scheduler tools — let the model read + mutate the
 * user's calendar, tasks, habits, and goals.
 *
 * Writes go through the admin Firestore SDK so the agent loop can
 * mutate without re-authenticating per call. Reads are scoped to
 * the user's project subtree.
 *
 * Every tool validates its arguments and returns a structured
 * result the model can reason about on the next turn.
 */

import "server-only";
import { randomUUID } from "node:crypto";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import type { Tool, ToolContext } from "./types";
import { toolError } from "./types";

const EVENTS = "events";
const TASKS = "tasks";
const HABITS = "habits";
const GOALS = "goals";

function projectPath(uid: string, projectId: string): string {
  return `users/${uid}/projects/${projectId}`;
}

function ensureProject(ctx: ToolContext, args: Record<string, unknown>): string | null {
  const explicit = typeof args.projectId === "string" ? args.projectId : null;
  return explicit ?? ctx.projectId;
}

/* ─────────────────────────── list events ─────────────────────────── */

const listEvents: Tool = {
  name: "calendar_list_events",
  category: "calendar",
  definition: {
    type: "function",
    function: {
      name: "calendar_list_events",
      description:
        "Read the user's calendar events between two ISO timestamps. Use this BEFORE creating new events to avoid double-booking, and to understand the user's existing rhythm.",
      parameters: {
        type: "object",
        properties: {
          start: { type: "string", description: "ISO-8601 start of the range (inclusive)." },
          end: { type: "string", description: "ISO-8601 end of the range (exclusive)." },
          projectId: {
            type: "string",
            description:
              "Optional project to scope to. Defaults to the active project. Pass empty string to read across all projects.",
          },
        },
        required: ["start", "end"],
      },
    },
  },
  handler: async (args, ctx) => {
    const start = typeof args.start === "string" ? args.start : "";
    const end = typeof args.end === "string" ? args.end : "";
    if (!start || !end) return toolError("start and end (ISO timestamps) are required");
    const projectId = ensureProject(ctx, args);
    const fs = getAdminFirestore();
    const docs: Record<string, unknown>[] = [];
    if (projectId) {
      const snap = await fs
        .collection(`${projectPath(ctx.uid, projectId)}/${EVENTS}`)
        .where("start", ">=", start)
        .where("start", "<=", end)
        .get();
      for (const d of snap.docs) docs.push({ id: d.id, ...d.data() });
    }
    // Also surface mirrored Google / Notion events from the user-scoped collection.
    try {
      const mirror = await fs
        .collection(`users/${ctx.uid}/google_events`)
        .where("start", ">=", start)
        .where("start", "<=", end)
        .get();
      for (const d of mirror.docs) docs.push({ id: d.id, ...d.data() });
    } catch {
      /* mirror not present — fine */
    }
    return { events: docs, count: docs.length };
  },
};

/* ─────────────────────────── create event ─────────────────────────── */

const createEvent: Tool = {
  name: "calendar_create_event",
  category: "calendar",
  definition: {
    type: "function",
    function: {
      name: "calendar_create_event",
      description:
        "Schedule a new event on the user's calendar. Returns the created event with its assigned id.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "Short, human-readable title." },
          start: { type: "string", description: "ISO-8601 start timestamp." },
          end: { type: "string", description: "ISO-8601 end timestamp." },
          description: { type: "string", description: "Optional longer description." },
          location: { type: "string", description: "Optional location string." },
          kind: {
            type: "string",
            enum: ["meeting", "focus", "break", "exercise", "personal", "other"],
            description: "Semantic category of the event.",
          },
          projectId: { type: "string", description: "Project to associate. Defaults to active." },
        },
        required: ["title", "start", "end"],
      },
    },
  },
  handler: async (args, ctx) => {
    const projectId = ensureProject(ctx, args);
    if (!projectId) return toolError("No active project — pass projectId explicitly.");
    const title = typeof args.title === "string" ? args.title : "";
    const start = typeof args.start === "string" ? args.start : "";
    const end = typeof args.end === "string" ? args.end : "";
    if (!title || !start || !end) {
      return toolError("title, start, end are required");
    }
    const id = `evt_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const event = {
      id,
      projectId,
      userId: ctx.uid,
      title,
      start,
      end,
      description: typeof args.description === "string" ? args.description : undefined,
      location: typeof args.location === "string" ? args.location : undefined,
      kind: typeof args.kind === "string" ? args.kind : "other",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      source: "agent" as const,
    };
    const fs = getAdminFirestore();
    await fs
      .doc(`${projectPath(ctx.uid, projectId)}/${EVENTS}/${id}`)
      .set(stripUndefined(event));
    return { ok: true, event: { ...event, createdAt: undefined, updatedAt: undefined } };
  },
};

/* ─────────────────────────── update event ─────────────────────────── */

const updateEvent: Tool = {
  name: "calendar_update_event",
  category: "calendar",
  definition: {
    type: "function",
    function: {
      name: "calendar_update_event",
      description:
        "Move or edit an existing event. Pass only the fields you want to change.",
      parameters: {
        type: "object",
        properties: {
          eventId: { type: "string", description: "Id returned from calendar_list_events / calendar_create_event." },
          projectId: { type: "string", description: "Project id the event lives under." },
          title: { type: "string" },
          start: { type: "string", description: "New ISO start timestamp." },
          end: { type: "string", description: "New ISO end timestamp." },
          description: { type: "string" },
          location: { type: "string" },
        },
        required: ["eventId"],
      },
    },
  },
  handler: async (args, ctx) => {
    const projectId = ensureProject(ctx, args);
    if (!projectId) return toolError("No active project — pass projectId explicitly.");
    const eventId = typeof args.eventId === "string" ? args.eventId : "";
    if (!eventId) return toolError("eventId is required");
    const patch = stripUndefined({
      title: typeof args.title === "string" ? args.title : undefined,
      start: typeof args.start === "string" ? args.start : undefined,
      end: typeof args.end === "string" ? args.end : undefined,
      description: typeof args.description === "string" ? args.description : undefined,
      location: typeof args.location === "string" ? args.location : undefined,
      updatedAt: FieldValue.serverTimestamp(),
    });
    const fs = getAdminFirestore();
    await fs
      .doc(`${projectPath(ctx.uid, projectId)}/${EVENTS}/${eventId}`)
      .set(patch, { merge: true });
    return { ok: true, eventId, patch };
  },
};

/* ─────────────────────────── delete event ─────────────────────────── */

const deleteEvent: Tool = {
  name: "calendar_delete_event",
  category: "calendar",
  definition: {
    type: "function",
    function: {
      name: "calendar_delete_event",
      description: "Cancel an event. Use sparingly — prefer update when re-scheduling.",
      parameters: {
        type: "object",
        properties: {
          eventId: { type: "string" },
          projectId: { type: "string" },
        },
        required: ["eventId"],
      },
    },
  },
  handler: async (args, ctx) => {
    const projectId = ensureProject(ctx, args);
    if (!projectId) return toolError("No active project — pass projectId explicitly.");
    const eventId = typeof args.eventId === "string" ? args.eventId : "";
    if (!eventId) return toolError("eventId is required");
    const fs = getAdminFirestore();
    await fs.doc(`${projectPath(ctx.uid, projectId)}/${EVENTS}/${eventId}`).delete();
    return { ok: true, eventId };
  },
};

/* ─────────────────────────── tasks / habits / goals ─────────────────────────── */

const createTask: Tool = {
  name: "tasks_create",
  category: "tasks",
  definition: {
    type: "function",
    function: {
      name: "tasks_create",
      description: "Create a task on the user's list. Optionally bound to a goal.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          due: { type: "string", description: "ISO due date." },
          priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
          boundGoalId: { type: "string", description: "Goal id this task laddered up to." },
          estimateMin: { type: "number", description: "Estimated minutes of effort." },
          projectId: { type: "string" },
        },
        required: ["title"],
      },
    },
  },
  handler: async (args, ctx) => {
    const projectId = ensureProject(ctx, args);
    if (!projectId) return toolError("No active project — pass projectId explicitly.");
    const title = typeof args.title === "string" ? args.title : "";
    if (!title) return toolError("title is required");
    const id = `task_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const task = stripUndefined({
      id,
      projectId,
      userId: ctx.uid,
      title,
      due: typeof args.due === "string" ? args.due : undefined,
      priority: typeof args.priority === "string" ? args.priority : "normal",
      boundGoalId: typeof args.boundGoalId === "string" ? args.boundGoalId : undefined,
      estimateMin: typeof args.estimateMin === "number" ? args.estimateMin : undefined,
      status: "pending" as const,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      source: "agent" as const,
    });
    const fs = getAdminFirestore();
    await fs.doc(`${projectPath(ctx.uid, projectId)}/${TASKS}/${id}`).set(task);
    return { ok: true, task: { ...task, createdAt: undefined, updatedAt: undefined } };
  },
};

const createHabit: Tool = {
  name: "habits_create",
  category: "tasks",
  definition: {
    type: "function",
    function: {
      name: "habits_create",
      description: "Create a recurring habit.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          cadence: { type: "string", enum: ["daily", "weekly", "weekdays"] },
          preferredTimeOfDay: { type: "string", enum: ["morning", "midday", "evening"] },
          projectId: { type: "string" },
        },
        required: ["title", "cadence"],
      },
    },
  },
  handler: async (args, ctx) => {
    const projectId = ensureProject(ctx, args);
    if (!projectId) return toolError("No active project — pass projectId explicitly.");
    const title = typeof args.title === "string" ? args.title : "";
    if (!title) return toolError("title is required");
    const id = `habit_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const habit = stripUndefined({
      id,
      projectId,
      userId: ctx.uid,
      title,
      cadence: typeof args.cadence === "string" ? args.cadence : "daily",
      preferredTimeOfDay:
        typeof args.preferredTimeOfDay === "string" ? args.preferredTimeOfDay : undefined,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      source: "agent" as const,
    });
    const fs = getAdminFirestore();
    await fs.doc(`${projectPath(ctx.uid, projectId)}/${HABITS}/${id}`).set(habit);
    return { ok: true, habit: { ...habit, createdAt: undefined, updatedAt: undefined } };
  },
};

const createGoal: Tool = {
  name: "goals_create",
  category: "tasks",
  definition: {
    type: "function",
    function: {
      name: "goals_create",
      description: "Create a goal that can have tasks laddered to it.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string" },
          deadline: { type: "string", description: "Optional ISO target date." },
          target: { type: "string", description: "Short description of success criteria." },
          projectId: { type: "string" },
        },
        required: ["title"],
      },
    },
  },
  handler: async (args, ctx) => {
    const projectId = ensureProject(ctx, args);
    if (!projectId) return toolError("No active project — pass projectId explicitly.");
    const title = typeof args.title === "string" ? args.title : "";
    if (!title) return toolError("title is required");
    const id = `goal_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const goal = stripUndefined({
      id,
      projectId,
      userId: ctx.uid,
      title,
      deadline: typeof args.deadline === "string" ? args.deadline : undefined,
      target: typeof args.target === "string" ? args.target : undefined,
      status: "active" as const,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      source: "agent" as const,
    });
    const fs = getAdminFirestore();
    await fs.doc(`${projectPath(ctx.uid, projectId)}/${GOALS}/${id}`).set(goal);
    return { ok: true, goal: { ...goal, createdAt: undefined, updatedAt: undefined } };
  },
};

const listTasks: Tool = {
  name: "tasks_list",
  category: "tasks",
  definition: {
    type: "function",
    function: {
      name: "tasks_list",
      description: "List the user's open tasks in a project.",
      parameters: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          status: { type: "string", enum: ["pending", "in_progress", "done", "all"] },
        },
        required: [],
      },
    },
  },
  handler: async (args, ctx) => {
    const projectId = ensureProject(ctx, args);
    if (!projectId) return toolError("No active project — pass projectId explicitly.");
    const status = typeof args.status === "string" ? args.status : "pending";
    const fs = getAdminFirestore();
    let q = fs.collection(`${projectPath(ctx.uid, projectId)}/${TASKS}`).where("userId", "==", ctx.uid);
    if (status !== "all") q = q.where("status", "==", status);
    const snap = await q.limit(100).get();
    return {
      tasks: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      count: snap.size,
    };
  },
};

/* ─────────────────────────── helpers ─────────────────────────── */

function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

export const CALENDAR_TOOLS: Tool[] = [
  listEvents,
  createEvent,
  updateEvent,
  deleteEvent,
  createTask,
  createHabit,
  createGoal,
  listTasks,
];
