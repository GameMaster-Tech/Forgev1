/**
 * Invariant DSL — serialisable predicate definitions (spec §4 Phase 4).
 *
 * The user-driven builder needs invariants that survive a Firestore
 * round-trip; closures don't. This module defines a JSON-friendly DSL
 * with a compiler that turns each config into a concrete
 * `WorkspaceInvariant` ready for `ForgeSyncCompiler`. Wiring back into
 * the pre-merge pipeline is just a list comprehension.
 *
 * Supported predicate kinds (matching the spec's named examples + the
 * common patterns we already use):
 *
 *   • deep-work-floor              — DailyDeepWork >= N hours
 *   • daily-commitment-ceiling     — total committed hours per day ≤ N
 *   • dependency-buffer            — downstream ≥ upstream-end + N hours
 *   • no-calendar-overlap          — no two events overlap
 *   • goal-deadline-protected      — goal endDate ≥ downstream items
 *   • per-day-event-count          — events per local day ≤ N
 *   • node-field-range             — numeric metadata.<key> within [min,max]
 *   • node-field-equals            — categorical metadata.<key> equals expected
 *
 * Every entry has its own typed param shape so the UI can render the
 * right control set (slider for hours, dropdown for category, etc.).
 */

import {
  dailyDeepWorkFloor,
  dependencyBufferRespected,
  goalDeadlineProtected,
  maxDailyCommitmentHours,
  noCalendarOverlap,
} from "./invariants";
import {
  ForgeNodeCategory,
  type ForgeGraphNode,
  type NodeId,
  type WorkspaceInvariant,
} from "./types";

export type InvariantKind =
  | "deep-work-floor"
  | "daily-commitment-ceiling"
  | "dependency-buffer"
  | "no-calendar-overlap"
  | "goal-deadline-protected"
  | "per-day-event-count"
  | "node-field-range"
  | "node-field-equals";

interface BaseConfig<K extends InvariantKind, P> {
  id: string;
  /** User-facing name. */
  name: string;
  /** Optional free-form note shown next to the rule. */
  description?: string;
  /** When true, a failure blocks merge entirely. */
  blocking: boolean;
  kind: K;
  params: P;
  /** Last edit, ms epoch. */
  updatedAt: number;
  /** Whether the user has the rule turned on. */
  enabled: boolean;
}

export type InvariantConfig =
  | BaseConfig<"deep-work-floor", { minHours: number }>
  | BaseConfig<"daily-commitment-ceiling", { maxHours: number }>
  | BaseConfig<"dependency-buffer", { bufferHours: number }>
  | BaseConfig<"no-calendar-overlap", Record<string, never>>
  | BaseConfig<"goal-deadline-protected", Record<string, never>>
  | BaseConfig<"per-day-event-count", { maxCount: number }>
  | BaseConfig<"node-field-range", {
      category: ForgeNodeCategory | "ANY";
      field: string;
      min?: number;
      max?: number;
    }>
  | BaseConfig<"node-field-equals", {
      category: ForgeNodeCategory | "ANY";
      field: string;
      expected: string;
    }>;

/**
 * Static catalogue used by the builder UI. The UI shows the label,
 * pulls the default params, and renders the right control set.
 */
export interface InvariantKindMeta {
  kind: InvariantKind;
  label: string;
  summary: string;
  defaultParams: Record<string, unknown>;
}

export const INVARIANT_CATALOGUE: InvariantKindMeta[] = [
  {
    kind: "deep-work-floor",
    label: "Deep-work floor",
    summary: "Each day must reserve at least N hours of deep work.",
    defaultParams: { minHours: 4 },
  },
  {
    kind: "daily-commitment-ceiling",
    label: "Daily commitment ceiling",
    summary: "Total committed hours per day cannot exceed N.",
    defaultParams: { maxHours: 12 },
  },
  {
    kind: "dependency-buffer",
    label: "Dependency buffer",
    summary: "Downstream items trail upstream items by at least N hours.",
    defaultParams: { bufferHours: 0 },
  },
  {
    kind: "no-calendar-overlap",
    label: "No calendar overlap",
    summary: "Two timed events cannot overlap on the canonical calendar.",
    defaultParams: {},
  },
  {
    kind: "goal-deadline-protected",
    label: "Goal deadline protected",
    summary: "A goal's target date cannot precede its dependent events.",
    defaultParams: {},
  },
  {
    kind: "per-day-event-count",
    label: "Per-day event cap",
    summary: "Calendar events per local day cannot exceed N.",
    defaultParams: { maxCount: 6 },
  },
  {
    kind: "node-field-range",
    label: "Field within range",
    summary: "A numeric metadata field must stay within [min, max].",
    defaultParams: { category: "DATA", field: "value", min: 0, max: 100 },
  },
  {
    kind: "node-field-equals",
    label: "Field equals value",
    summary: "A categorical metadata field must equal a value.",
    defaultParams: { category: "DATA", field: "status", expected: "STABLE" },
  },
];

/**
 * Compile a serialisable config into the concrete runtime predicate the
 * compiler runs in the hot path. Returns `null` for unknown kinds —
 * caller filters those out.
 */
export function compileInvariant(
  config: InvariantConfig,
): WorkspaceInvariant | null {
  if (!config.enabled) return null;
  switch (config.kind) {
    case "deep-work-floor": {
      const inv = dailyDeepWorkFloor(config.params.minHours);
      return decorate(inv, config);
    }
    case "daily-commitment-ceiling": {
      const inv = maxDailyCommitmentHours(config.params.maxHours);
      return decorate(inv, config);
    }
    case "dependency-buffer": {
      const inv = dependencyBufferRespected(config.params.bufferHours);
      return decorate(inv, config);
    }
    case "no-calendar-overlap":
      return decorate(noCalendarOverlap(), config);
    case "goal-deadline-protected":
      return decorate(goalDeadlineProtected(), config);
    case "per-day-event-count":
      return {
        id: config.id,
        description: config.description ?? config.name,
        blocking: config.blocking,
        evaluator: (graph) => evaluatePerDayEventCount(graph, config.params.maxCount),
      };
    case "node-field-range":
      return {
        id: config.id,
        description: config.description ?? config.name,
        blocking: config.blocking,
        evaluator: (graph) =>
          evaluateNodeFieldRange(
            graph,
            config.params.category,
            config.params.field,
            config.params.min,
            config.params.max,
          ),
      };
    case "node-field-equals":
      return {
        id: config.id,
        description: config.description ?? config.name,
        blocking: config.blocking,
        evaluator: (graph) =>
          evaluateNodeFieldEquals(
            graph,
            config.params.category,
            config.params.field,
            config.params.expected,
          ),
      };
  }
}

export function compileAll(configs: InvariantConfig[]): WorkspaceInvariant[] {
  const out: WorkspaceInvariant[] = [];
  for (let i = 0; i < configs.length; i++) {
    const compiled = compileInvariant(configs[i]);
    if (compiled) out.push(compiled);
  }
  return out;
}

/* ──────── kind-specific evaluators ──────── */

function evaluatePerDayEventCount(
  graph: Map<NodeId, ForgeGraphNode>,
  maxCount: number,
) {
  const perDay = new Map<string, number>();
  const offendersByDay = new Map<string, NodeId[]>();
  for (const node of graph.values()) {
    if (node.category !== ForgeNodeCategory.CALENDAR_EVENT) continue;
    const start = node.payload.metadata.startDate;
    if (!(start instanceof Date)) continue;
    const key = isoDay(start);
    perDay.set(key, (perDay.get(key) ?? 0) + 1);
    const arr = offendersByDay.get(key);
    if (arr) arr.push(node.id);
    else offendersByDay.set(key, [node.id]);
  }
  const breaches: string[] = [];
  const offending: NodeId[] = [];
  for (const [day, count] of perDay) {
    if (count > maxCount) {
      breaches.push(`${day}: ${count}`);
      const ids = offendersByDay.get(day);
      if (ids) for (let i = 0; i < ids.length; i++) offending.push(ids[i]);
    }
  }
  if (breaches.length === 0) return { passed: true };
  return {
    passed: false,
    errorDetail: `Per-day cap of ${maxCount} breached on: ${breaches.join(", ")}`,
    offendingNodeIds: offending,
  };
}

function evaluateNodeFieldRange(
  graph: Map<NodeId, ForgeGraphNode>,
  category: ForgeNodeCategory | "ANY",
  field: string,
  min: number | undefined,
  max: number | undefined,
) {
  const offending: NodeId[] = [];
  for (const node of graph.values()) {
    if (category !== "ANY" && node.category !== category) continue;
    const value = node.payload.metadata[field];
    if (typeof value !== "number") continue;
    if (typeof min === "number" && value < min) {
      offending.push(node.id);
      continue;
    }
    if (typeof max === "number" && value > max) {
      offending.push(node.id);
    }
  }
  if (offending.length === 0) return { passed: true };
  return {
    passed: false,
    errorDetail: `${offending.length} node(s) have ${field} outside [${min ?? "-∞"}, ${max ?? "+∞"}].`,
    offendingNodeIds: offending,
  };
}

function evaluateNodeFieldEquals(
  graph: Map<NodeId, ForgeGraphNode>,
  category: ForgeNodeCategory | "ANY",
  field: string,
  expected: string,
) {
  const offending: NodeId[] = [];
  for (const node of graph.values()) {
    if (category !== "ANY" && node.category !== category) continue;
    const value = node.payload.metadata[field];
    if (value === undefined || value === null) continue;
    if (String(value) !== expected) offending.push(node.id);
  }
  if (offending.length === 0) return { passed: true };
  return {
    passed: false,
    errorDetail: `${offending.length} node(s) have ${field} ≠ "${expected}".`,
    offendingNodeIds: offending,
  };
}

/* ──────── helpers ──────── */

function decorate(
  base: WorkspaceInvariant,
  config: InvariantConfig,
): WorkspaceInvariant {
  return {
    id: config.id,
    description: config.description ?? config.name,
    blocking: config.blocking,
    evaluator: base.evaluator,
  };
}

function isoDay(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Factory helper for the UI: create a fresh config with sensible
 * defaults for the chosen kind. The caller owns the `id`.
 */
export function freshConfig(kind: InvariantKind, id: string): InvariantConfig {
  const meta = INVARIANT_CATALOGUE.find((m) => m.kind === kind);
  if (!meta) throw new Error(`Unknown invariant kind: ${kind}`);
  return {
    id,
    name: meta.label,
    description: meta.summary,
    blocking: true,
    kind,
    params: { ...meta.defaultParams },
    updatedAt: Date.now(),
    enabled: true,
  } as InvariantConfig;
}
