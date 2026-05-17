/**
 * Recursive solver — drives the project graph to a Stable State.
 *
 * Algorithm:
 *   1. Detect every violation.
 *   2. For each violation, pick the *flexible* node to adjust:
 *      • prefer the lowest-confidence assertion involved,
 *      • never touch a locked assertion,
 *      • if the kind has a market oracle, anchor on the oracle value,
 *      • otherwise rebalance using the simplest arithmetic move.
 *   3. Apply changes to a **clone** of the graph, not the live one.
 *   4. Re-lint. If new violations appeared and we still have budget,
 *      recurse.
 *   5. Halt when either zero hard violations remain or the iteration
 *      cap is hit. Return everything we changed as a LogicalPatch.
 *
 * Single-function call: `proposePatch(graph, options)`.
 */

import { DependencyGraph } from "./graph";
import { detectViolations } from "./detect";
import { log } from "../observability";
import { lookup, marketRef, type MarketQuote } from "./market";
import type {
  Assertion,
  AssertionId,
  AssertionValue,
  LogicalPatch,
  ProposedChange,
  StabilityReport,
  Violation,
  ConstraintEdge,
} from "./types";

export interface SolverOptions {
  /** Hard cap on solver iterations. Default 8. */
  maxIterations?: number;
  /** Floor under which the engine won't auto-edit an assertion. */
  confidenceFloor?: number;
  /** When true, propose changes even for soft violations. Default true. */
  resolveSoft?: boolean;
  /** Override the "now" timestamp for deterministic tests. */
  now?: number;
}

const DEFAULTS: Required<Pick<SolverOptions, "maxIterations" | "confidenceFloor" | "resolveSoft">> = {
  maxIterations: 8,
  confidenceFloor: 0.95,
  resolveSoft: true,
};

/** Quick stability check without proposing a patch. */
export function checkStability(graph: DependencyGraph): StabilityReport {
  const violations = detectViolations(graph);
  return {
    projectId: graph.projectId,
    isStable: violations.every((v) => v.severity !== "hard"),
    hardViolations: violations.filter((v) => v.severity === "hard").length,
    softViolations: violations.filter((v) => v.severity === "soft").length,
    assertionsChecked: graph.listAssertions().length,
    constraintsChecked: graph.listConstraints().length,
    ranAt: new Date().toISOString(),
  };
}

/**
 * Main entry point: lint → propose → re-lint → return.
 *
 * The input graph is **not mutated**. Apply the returned patch via
 * `applyPatch(graph, patch)` if you want the changes to land.
 */
export function proposePatch(
  source: DependencyGraph,
  options: SolverOptions = {},
): LogicalPatch {
  const opts = { ...DEFAULTS, ...options };
  const startedAt = Date.now();
  const work = cloneGraph(source);

  const resolved: Violation[] = [];
  const changesById = new Map<AssertionId, ProposedChange>();
  let iterations = 0;

  for (; iterations < opts.maxIterations; iterations++) {
    const violations = detectViolations(work).filter((v) =>
      opts.resolveSoft ? true : v.severity === "hard",
    );
    if (violations.length === 0) break;

    let madeProgress = false;
    for (const v of violations) {
      const change = resolveOne(work, v, opts);
      if (!change) continue;
      // Apply to the working graph so subsequent iterations see the new value.
      const target = work.getAssertion(change.assertionId);
      if (!target) continue;
      work.upsertAssertion({
        ...target,
        value: change.after,
        confidence: change.confidence,
        sourcedAt: opts.now ?? Date.now(),
        source: change.marketRef ?? "sync.solver",
      });
      // Replace any prior proposed change for this id (only the final
      // before→after of a given id is meaningful in the patch).
      const prior = changesById.get(change.assertionId);
      changesById.set(change.assertionId, prior ? { ...change, before: prior.before } : change);
      resolved.push(v);
      madeProgress = true;
    }
    if (!madeProgress) break;
  }

  const after = detectViolations(work);
  const reachesStableState = after.every((v) => v.severity !== "hard");

  const changes = Array.from(changesById.values());
  log.event("sync.compile", {
    projectId: source.projectId,
    assertions: source.listAssertions().length,
    violations: after.length,
    patches: changes.length,
    durationMs: Date.now() - startedAt,
  });
  return {
    id: `patch_${(opts.now ?? Date.now()).toString(36)}`,
    projectId: source.projectId,
    generatedAt: opts.now ?? Date.now(),
    resolves: dedupeViolations(resolved),
    changes,
    iterations,
    reachesStableState,
    summary: summarise(changes, source),
  };
}

/** Apply a patch to a *mutable* graph in-place. Returns the same graph. */
export function applyPatch(graph: DependencyGraph, patch: LogicalPatch): DependencyGraph {
  for (const c of patch.changes) {
    const cur = graph.getAssertion(c.assertionId);
    if (!cur) continue;
    graph.upsertAssertion({
      ...cur,
      value: c.after,
      confidence: c.confidence,
      sourcedAt: Date.now(),
      source: c.marketRef ?? "sync.solver",
    });
  }
  return graph;
}

/* ───────────── internals ───────────── */

function cloneGraph(g: DependencyGraph): DependencyGraph {
  const out = new DependencyGraph(g.projectId);
  for (const d of g.listDocuments()) out.upsertDocument(d);
  for (const a of g.listAssertions()) out.upsertAssertion(a);
  for (const e of g.listConstraints()) out.upsertConstraint(e);
  return out;
}

function resolveOne(
  graph: DependencyGraph,
  v: Violation,
  opts: SolverOptions,
): ProposedChange | null {
  const edge = graph.getConstraint(v.constraintId);
  if (!edge) return null;

  // Pick the most "flexible" node — lowest confidence, not locked. If
  // everything is locked or above the floor, abort: only the user can
  // resolve this.
  const candidates = v.involved
    .map((id) => graph.getAssertion(id))
    .filter((a): a is Assertion => !!a && !a.locked && a.confidence < (opts.confidenceFloor ?? 0.95));

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.confidence - b.confidence);
  const flex = candidates[0];

  // For sum-style constraints (less-than-or-equal w/ array from), the
  // right move is *always* to rebalance — anchoring a single line item
  // to a market value would push the sum further off.
  const isSumConstraint =
    Array.isArray(edge.from) &&
    edge.from.length > 1 &&
    (edge.kind === "less-than" || edge.kind === "less-than-or-equal" ||
     edge.kind === "greater-than" || edge.kind === "greater-than-or-equal" ||
     edge.kind === "sum-equals");
  if (isSumConstraint) {
    const balanced = rebalance(graph, edge, flex);
    if (balanced) return balanced;
  }

  // Otherwise: prefer the market anchor first, fall back to rebalance.
  const oracle = oracleFor(flex);
  if (oracle) {
    return {
      assertionId: flex.id,
      before: flex.value,
      after: { type: "number", value: oracle.value, unit: oracle.unit },
      rationale: `Anchored on ${oracle.source}; previous value ${describe(flex.value)} fell outside the ${(oracle.band.high - oracle.band.low).toLocaleString()}-wide ${oracle.unit} band.`,
      confidence: oracle.confidence,
      marketRef: marketRef({ kind: flex.kind, tag: tagFor(flex) }),
    };
  }

  const balanced = rebalance(graph, edge, flex);
  if (balanced) return balanced;

  return null;
}

function oracleFor(a: Assertion): MarketQuote | null {
  return lookup({ kind: a.kind, tag: tagFor(a) });
}

function tagFor(a: Assertion): string | undefined {
  // The key hints at the tag: "engineering.senior.salary" → "senior"
  const segs = a.key.split(".");
  if (segs.length > 1) return segs.slice(0, -1).join("-");
  return undefined;
}

function rebalance(
  graph: DependencyGraph,
  edge: ConstraintEdge,
  flex: Assertion,
): ProposedChange | null {
  if (flex.value.type !== "number") return null;
  const t = graph.getAssertion(edge.to);
  if (!t) return null;
  const fromIds = Array.isArray(edge.from) ? edge.from : [edge.from];
  const sources = fromIds.map((id) => graph.getAssertion(id)).filter(Boolean) as Assertion[];
  const isSumFlex = sources.some((s) => s.id === flex.id);

  if (edge.kind === "sum-equals" && t.value.type === "number") {
    if (isSumFlex) {
      const fixedSum = sources
        .filter((s) => s.id !== flex.id)
        .reduce((acc, s) => acc + (s.value.type === "number" ? s.value.value : 0), 0);
      const newVal = Math.max(0, t.value.value - fixedSum);
      return {
        assertionId: flex.id,
        before: flex.value,
        after: { type: "number", value: newVal, unit: flex.value.unit },
        rationale: `Rebalanced ${flex.label} so the line items sum to the declared total.`,
        confidence: 0.72,
      };
    }
    if (flex.id === t.id) {
      const sum = sources.reduce((acc, s) => acc + (s.value.type === "number" ? s.value.value : 0), 0);
      return {
        assertionId: flex.id,
        before: flex.value,
        after: { type: "number", value: sum, unit: flex.value.unit },
        rationale: `Updated ${flex.label} to match the sum of its line items.`,
        confidence: 0.72,
      };
    }
  }

  // Multi-source ≤ operand: bring Σ down to operand by trimming flex.
  if (
    (edge.kind === "less-than" || edge.kind === "less-than-or-equal") &&
    edge.operand != null &&
    isSumFlex
  ) {
    const fixedSum = sources
      .filter((s) => s.id !== flex.id)
      .reduce((acc, s) => acc + (s.value.type === "number" ? s.value.value : 0), 0);
    const newVal = Math.max(0, edge.operand - fixedSum);
    return {
      assertionId: flex.id,
      before: flex.value,
      after: { type: "number", value: newVal, unit: flex.value.unit },
      rationale: `Trimmed ${flex.label} so the line items fit under ${edge.operand.toLocaleString()} ${flex.value.unit ?? ""}.`,
      confidence: 0.7,
    };
  }
  // Multi-source ≥ operand: lift flex until Σ ≥ operand.
  if (
    (edge.kind === "greater-than" || edge.kind === "greater-than-or-equal") &&
    edge.operand != null &&
    isSumFlex
  ) {
    const fixedSum = sources
      .filter((s) => s.id !== flex.id)
      .reduce((acc, s) => acc + (s.value.type === "number" ? s.value.value : 0), 0);
    const newVal = Math.max(0, edge.operand - fixedSum);
    return {
      assertionId: flex.id,
      before: flex.value,
      after: { type: "number", value: newVal, unit: flex.value.unit },
      rationale: `Raised ${flex.label} so the line items meet the floor of ${edge.operand.toLocaleString()} ${flex.value.unit ?? ""}.`,
      confidence: 0.7,
    };
  }

  // Single-target bound case (flex IS the target).
  if (
    (edge.kind === "less-than" || edge.kind === "less-than-or-equal") &&
    edge.operand != null &&
    flex.id === t.id
  ) {
    return {
      assertionId: flex.id,
      before: flex.value,
      after: { type: "number", value: Math.max(0, edge.operand), unit: flex.value.unit },
      rationale: `Clamped ${flex.label} to its upper bound (${edge.operand.toLocaleString()}).`,
      confidence: 0.6,
    };
  }
  if (
    (edge.kind === "greater-than" || edge.kind === "greater-than-or-equal") &&
    edge.operand != null &&
    flex.id === t.id
  ) {
    return {
      assertionId: flex.id,
      before: flex.value,
      after: { type: "number", value: Math.max(0, edge.operand), unit: flex.value.unit },
      rationale: `Raised ${flex.label} to its lower bound (${edge.operand.toLocaleString()}).`,
      confidence: 0.6,
    };
  }

  return null;
}

function describe(v: AssertionValue): string {
  switch (v.type) {
    case "number": return `${v.value.toLocaleString()}${v.unit ? " " + v.unit : ""}`;
    case "string": return `"${v.value}"`;
    case "date": return v.value;
    case "boolean": return v.value ? "true" : "false";
  }
}

function dedupeViolations(vs: Violation[]): Violation[] {
  const seen = new Set<string>();
  const out: Violation[] = [];
  for (const v of vs) {
    if (seen.has(v.constraintId)) continue;
    seen.add(v.constraintId);
    out.push(v);
  }
  return out;
}

function summarise(changes: ProposedChange[], src: DependencyGraph): string {
  if (changes.length === 0) return "No changes — workspace already in a Stable State.";
  const parts: string[] = [];
  for (const c of changes) {
    const a = src.getAssertion(c.assertionId);
    if (!a) continue;
    const before = describe(c.before);
    const after = describe(c.after);
    parts.push(`${a.label}: ${before} → ${after}`);
  }
  return parts.join(" · ");
}
