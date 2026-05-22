/**
 * Workspace invariants — pre-merge predicates the compiler runs on the
 * sandbox before letting a delta through.
 *
 * The Phase 4 UI builds dynamic invariants via `defineInvariant`. The
 * built-in set below covers the spec's named examples:
 *
 *   • Daily-deep-work floor (`DailyDeepWork >= N_hours`)
 *   • Calendar overlap absence
 *   • Capacity overload ceiling
 *   • Dependency-buffer (downstream items can't precede their upstream
 *     deadline)
 *   • Goal-deadline slip (a goal's target date can't drift past the
 *     latest dependent calendar event)
 *
 * All evaluators are pure. None of them mutate the graph or each other.
 */

import {
  ForgeNodeCategory,
  type ForgeGraphNode,
  type InvariantEvaluation,
  type NodeId,
  type WorkspaceInvariant,
} from "./types";

/* ───────────────────── built-in factory ───────────────────── */

export function dailyDeepWorkFloor(minHours: number): WorkspaceInvariant {
  return {
    id: "invariant.deep-work.floor",
    description: `Each day must reserve at least ${minHours} hours of deep work.`,
    blocking: true,
    evaluator: (graph) => evaluateDailyDeepWork(graph, minHours),
  };
}

export function noCalendarOverlap(): WorkspaceInvariant {
  return {
    id: "invariant.calendar.no-overlap",
    description: "Two timed events must not overlap on the canonical calendar.",
    blocking: true,
    evaluator: evaluateNoOverlap,
  };
}

export function maxDailyCommitmentHours(maxHours: number): WorkspaceInvariant {
  return {
    id: "invariant.capacity.max-daily",
    description: `Total committed hours per day must not exceed ${maxHours}.`,
    blocking: true,
    evaluator: (graph) => evaluateMaxDailyHours(graph, maxHours),
  };
}

export function dependencyBufferRespected(bufferHours: number): WorkspaceInvariant {
  return {
    id: "invariant.dependency.buffer",
    description: `Downstream items must trail upstream items by at least ${bufferHours}h.`,
    blocking: true,
    evaluator: (graph) => evaluateDependencyBuffer(graph, bufferHours),
  };
}

export function goalDeadlineProtected(): WorkspaceInvariant {
  return {
    id: "invariant.goal.deadline-protected",
    description: "A goal's target date must not precede its dependent events.",
    blocking: false,
    evaluator: evaluateGoalDeadlineProtected,
  };
}

/**
 * Build the default invariant set the UI wires when the user hasn't
 * configured custom rules yet.
 */
export function defaultInvariants(): WorkspaceInvariant[] {
  return [
    dailyDeepWorkFloor(4),
    noCalendarOverlap(),
    maxDailyCommitmentHours(12),
    dependencyBufferRespected(0),
    goalDeadlineProtected(),
  ];
}

/* ───────────────────── dynamic builder ───────────────────── */

export interface DynamicInvariantDefinition {
  id: string;
  description: string;
  blocking?: boolean;
  evaluator: (graph: Map<NodeId, ForgeGraphNode>) => InvariantEvaluation;
}

/** Type-safe constructor used by the Phase 4 UI. */
export function defineInvariant(def: DynamicInvariantDefinition): WorkspaceInvariant {
  return {
    id: def.id,
    description: def.description,
    blocking: def.blocking ?? true,
    evaluator: def.evaluator,
  };
}

/* ───────────────────── evaluators ───────────────────── */

function evaluateDailyDeepWork(
  graph: Map<NodeId, ForgeGraphNode>,
  minHours: number,
): InvariantEvaluation {
  const dailyDeep = new Map<string, number>();
  for (const node of graph.values()) {
    if (
      node.category !== ForgeNodeCategory.CALENDAR_EVENT &&
      node.category !== ForgeNodeCategory.TASK
    )
      continue;
    const energy = node.payload.metadata.energy as string | undefined;
    if (energy !== "deep") continue;
    const start = asDate(node.payload.metadata.startDate);
    const duration = node.payload.metadata.durationHours;
    if (!start || typeof duration !== "number") continue;
    const dayKey = isoDay(start);
    dailyDeep.set(dayKey, (dailyDeep.get(dayKey) ?? 0) + duration);
  }

  const shortfalls: string[] = [];
  for (const [day, hours] of dailyDeep) {
    if (hours < minHours) shortfalls.push(`${day}: ${hours.toFixed(1)}h`);
  }
  if (dailyDeep.size === 0) {
    return {
      passed: false,
      errorDetail: `No deep-work blocks scheduled; floor is ${minHours}h/day.`,
    };
  }
  if (shortfalls.length === 0) return { passed: true };
  return {
    passed: false,
    errorDetail: `Deep-work floor breached on: ${shortfalls.join(", ")}`,
  };
}

function evaluateNoOverlap(
  graph: Map<NodeId, ForgeGraphNode>,
): InvariantEvaluation {
  interface Slot {
    id: NodeId;
    start: number;
    end: number;
  }
  const slots: Slot[] = [];
  for (const node of graph.values()) {
    if (node.category !== ForgeNodeCategory.CALENDAR_EVENT) continue;
    const start = asDate(node.payload.metadata.startDate);
    const end = asDate(node.payload.metadata.endDate);
    if (!start || !end) continue;
    slots.push({ id: node.id, start: start.getTime(), end: end.getTime() });
  }
  slots.sort((a, b) => a.start - b.start);

  const offenders: NodeId[] = [];
  for (let i = 1; i < slots.length; i++) {
    if (slots[i].start < slots[i - 1].end) {
      offenders.push(slots[i].id, slots[i - 1].id);
    }
  }
  if (offenders.length === 0) return { passed: true };
  return {
    passed: false,
    errorDetail: `${offenders.length / 2} overlap pair(s) detected.`,
    offendingNodeIds: Array.from(new Set(offenders)),
  };
}

function evaluateMaxDailyHours(
  graph: Map<NodeId, ForgeGraphNode>,
  maxHours: number,
): InvariantEvaluation {
  const daily = new Map<string, number>();
  for (const node of graph.values()) {
    if (
      node.category !== ForgeNodeCategory.CALENDAR_EVENT &&
      node.category !== ForgeNodeCategory.TASK
    )
      continue;
    const start = asDate(node.payload.metadata.startDate);
    const duration = node.payload.metadata.durationHours;
    if (!start || typeof duration !== "number") continue;
    const key = isoDay(start);
    daily.set(key, (daily.get(key) ?? 0) + duration);
  }
  const breaches: string[] = [];
  for (const [day, hours] of daily) {
    if (hours > maxHours) breaches.push(`${day}: ${hours.toFixed(1)}h`);
  }
  if (breaches.length === 0) return { passed: true };
  return {
    passed: false,
    errorDetail: `Overload on: ${breaches.join(", ")}`,
  };
}

function evaluateDependencyBuffer(
  graph: Map<NodeId, ForgeGraphNode>,
  bufferHours: number,
): InvariantEvaluation {
  const bufferMs = bufferHours * 3_600_000;
  const offenders: NodeId[] = [];
  for (const node of graph.values()) {
    const downStart = asDate(node.payload.metadata.startDate);
    if (!downStart) continue;
    for (let i = 0; i < node.upstreamDependencies.length; i++) {
      const parent = graph.get(node.upstreamDependencies[i]);
      if (!parent) continue;
      const parentEnd =
        asDate(parent.payload.metadata.endDate) ??
        asDate(parent.payload.metadata.startDate);
      if (!parentEnd) continue;
      if (downStart.getTime() < parentEnd.getTime() + bufferMs) {
        offenders.push(node.id);
        break;
      }
    }
  }
  if (offenders.length === 0) return { passed: true };
  return {
    passed: false,
    errorDetail: `${offenders.length} item(s) start before upstream deadline + ${bufferHours}h buffer.`,
    offendingNodeIds: offenders,
  };
}

function evaluateGoalDeadlineProtected(
  graph: Map<NodeId, ForgeGraphNode>,
): InvariantEvaluation {
  const offenders: NodeId[] = [];
  for (const node of graph.values()) {
    if (node.category !== ForgeNodeCategory.GOAL) continue;
    const goalEnd = asDate(node.payload.metadata.endDate);
    if (!goalEnd) continue;
    for (let i = 0; i < node.downstreamDependencies.length; i++) {
      const child = graph.get(node.downstreamDependencies[i]);
      if (!child) continue;
      const childStart = asDate(child.payload.metadata.startDate);
      if (childStart && childStart.getTime() > goalEnd.getTime()) {
        offenders.push(node.id);
        break;
      }
    }
  }
  if (offenders.length === 0) return { passed: true };
  return {
    passed: false,
    errorDetail: `${offenders.length} goal(s) have downstream items past their target date.`,
    offendingNodeIds: offenders,
  };
}

/* ───────────────────── helpers ───────────────────── */

function asDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === "string" || typeof v === "number") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function isoDay(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
