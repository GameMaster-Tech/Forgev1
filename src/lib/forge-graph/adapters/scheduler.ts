/**
 * Scheduler adapter — Tempo scheduler primitives projected onto the graph.
 *
 *   Goal   → GOAL node
 *   Habit  → GOAL node (a habit is a recurring micro-goal; collapses into
 *            the goal-gravity invariants without inventing a category)
 *   Task   → TASK node
 *
 * Tasks bound to assertion keys / goals get explicit dependency edges
 * back into the source nodes, which lets the impact simulator propagate
 * a salary or runway change into the schedule.
 */

import type {
  Goal,
  Habit,
  Task,
  TimedEvent,
} from "@/lib/scheduler/types";
import {
  ForgeNodeCategory,
  type ForgeGraphNode,
  type NodeId,
} from "../types";
import { assertionNodeId } from "./assertions";
import { calendarEventNodeId } from "./calendar-events";

export function goalNodeId(id: string): NodeId {
  return `goal:${id}`;
}

export function habitNodeId(id: string): NodeId {
  return `habit:${id}`;
}

export function taskNodeId(id: string): NodeId {
  return `task:${id}`;
}

export function goalToNode(g: Goal): ForgeGraphNode {
  return {
    id: goalNodeId(g.id),
    category: ForgeNodeCategory.GOAL,
    payload: {
      title: g.title,
      content: g.description ?? g.successCriteria ?? g.title,
      metadata: {
        startDate: new Date(g.createdAt),
        endDate: g.targetDate ? new Date(g.targetDate) : undefined,
        // weeklyMinutesTarget → allocatedCapacity 0-100 scale (cap at 40h/wk).
        allocatedCapacity: Math.min(100, Math.round((g.weeklyMinutesTarget / 2400) * 100)),
        weeklyMinutesTarget: g.weeklyMinutesTarget,
        loggedMinutes: g.loggedMinutes,
        status: g.status,
        targetDate: g.targetDate,
      },
    },
    upstreamDependencies: [],
    downstreamDependencies: [],
    status: g.status === "achieved" ? "STABLE" : "STABLE",
    version: Math.floor(g.createdAt / 1000),
    origin: { collection: "scheduler_goals", externalId: g.id, projectId: g.projectId },
  };
}

export function habitToNode(h: Habit): ForgeGraphNode {
  return {
    id: habitNodeId(h.id),
    category: ForgeNodeCategory.GOAL,
    payload: {
      title: h.title,
      content: `${h.title} — ${h.rrule}`,
      metadata: {
        startDate: new Date(h.createdAt),
        durationHours: h.durationMinutes / 60,
        allocatedCapacity: 100,
        energy: h.energy,
        rrule: h.rrule,
        streak: h.streak,
        lastCompletedAt: h.lastCompletedAt,
        archived: h.archivedAt != null,
      },
    },
    upstreamDependencies: [],
    downstreamDependencies: [],
    status: "STABLE",
    version: Math.floor(h.createdAt / 1000),
    origin: { collection: "scheduler_habits", externalId: h.id, projectId: h.projectId },
  };
}

export function taskToNode(t: Task): ForgeGraphNode {
  const start = t.start ? new Date(t.start) : undefined;
  const end = t.end ? new Date(t.end) : undefined;
  const upstream: NodeId[] = [];
  if (t.boundAssertionKeys && t.boundAssertionKeys.length > 0) {
    // We can't resolve key→id here without the live assertion list, so
    // we leave a marker and let the builder remap once it has the
    // assertion table. Persist the keys onto metadata for the builder.
  }
  if (t.boundGoalId) upstream.push(goalNodeId(t.boundGoalId));
  return {
    id: taskNodeId(t.id),
    category: ForgeNodeCategory.TASK,
    payload: {
      title: t.title,
      content: t.description ?? t.title,
      metadata: {
        startDate: start,
        endDate: end,
        durationHours: t.durationMinutes / 60,
        allocatedCapacity: t.progress * 100,
        energy: t.energy,
        due: t.due,
        progress: t.progress,
        status: t.status,
        pinned: t.pinned,
        boundAssertionKeys: t.boundAssertionKeys ?? [],
      },
    },
    upstreamDependencies: upstream,
    downstreamDependencies: [],
    status: t.status === "abandoned" ? "DRIFTING" : "STABLE",
    version: Math.floor(t.updatedAt / 1000),
    origin: { collection: "scheduler_tasks", externalId: t.id, projectId: t.projectId },
  };
}

export function timedEventToNode(e: TimedEvent): ForgeGraphNode {
  const start = new Date(e.start);
  const end = new Date(e.end);
  return {
    id: calendarEventNodeId(e.id),
    category: ForgeNodeCategory.CALENDAR_EVENT,
    payload: {
      title: e.title,
      content: e.description ?? e.title,
      metadata: {
        startDate: start,
        endDate: end,
        durationHours: Math.max(0, (end.getTime() - start.getTime()) / 3_600_000),
        allocatedCapacity: 100,
        energy: e.energy,
        kind: e.eventKind,
        pinned: e.pinned,
      },
    },
    upstreamDependencies: e.boundGoalId ? [goalNodeId(e.boundGoalId)] : [],
    downstreamDependencies: [],
    status: "STABLE",
    version: Math.floor(e.updatedAt / 1000),
    origin: { collection: "calendar_events", externalId: e.id, projectId: e.projectId },
  };
}

/**
 * After the full graph is assembled, this helper resolves task → assertion
 * upstream edges by mapping `boundAssertionKeys` (which is what the
 * scheduler stores) onto the actual assertion ids (which is what the
 * graph indexes).
 */
export function bindTaskAssertionEdges(
  nodes: ForgeGraphNode[],
  assertionKeyToId: Map<string, string>,
): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.category !== ForgeNodeCategory.TASK) continue;
    const keys = node.payload.metadata.boundAssertionKeys as string[] | undefined;
    if (!keys || keys.length === 0) continue;
    for (let k = 0; k < keys.length; k++) {
      const assertionId = assertionKeyToId.get(keys[k]);
      if (!assertionId) continue;
      const target = assertionNodeId(assertionId);
      if (node.upstreamDependencies.indexOf(target) === -1) {
        node.upstreamDependencies.push(target);
      }
    }
  }
}
