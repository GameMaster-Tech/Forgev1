/**
 * Conflict detection — walks every constraint, evaluates it, and emits a
 * `Violation` if the rule fails. Pure: no graph mutation, no I/O.
 */

import type { DependencyGraph } from "./graph";
import type {
  Assertion,
  AssertionId,
  ConstraintEdge,
  Violation,
} from "./types";

const num = (a: Assertion): number =>
  a.value.type === "number" ? a.value.value : Number.NaN;

const isNum = (a: Assertion): boolean => a.value.type === "number" && Number.isFinite(a.value.value);

function tol(c: ConstraintEdge): number {
  return c.tolerance ?? 0;
}

function fromList(edge: ConstraintEdge): AssertionId[] {
  return Array.isArray(edge.from) ? edge.from : [edge.from];
}

/**
 * Evaluate a single constraint. Returns `null` when satisfied, a
 * `Violation` when not.
 */
export function evaluate(
  graph: DependencyGraph,
  edge: ConstraintEdge,
): Violation | null {
  const target = graph.getAssertion(edge.to);
  if (!target) return null; // Dangling edges are ignored, not failures.

  const sources = fromList(edge).map((id) => graph.getAssertion(id)).filter(Boolean) as Assertion[];

  switch (edge.kind) {
    case "equals": {
      if (sources.length !== 1) return null;
      const s = sources[0];
      if (isNum(s) && isNum(target)) {
        const delta = Math.abs(num(target) - num(s));
        if (delta > tol(edge) * Math.max(1, Math.abs(num(s)))) {
          return mkViolation(edge, [s.id, target.id], delta,
            `${target.label} (${num(target)}) should equal ${s.label} (${num(s)}).`);
        }
        return null;
      }
      // Categorical equality.
      if (s.value.type === "string" && target.value.type === "string") {
        if (s.value.value !== target.value.value) {
          return mkViolation(edge, [s.id, target.id], 1,
            `${target.label} ("${target.value.value}") does not match ${s.label} ("${s.value.value}").`);
        }
      }
      return null;
    }

    case "sum-equals": {
      if (!isNum(target)) return null;
      const sum = sources.reduce((acc, s) => acc + (isNum(s) ? num(s) : 0), 0);
      const t = num(target);
      const delta = Math.abs(t - sum);
      if (delta > tol(edge) * Math.max(1, Math.abs(t))) {
        return mkViolation(edge, [...sources.map((s) => s.id), target.id], delta,
          `Sum of ${sources.map((s) => s.label).join(" + ")} = ${sum.toLocaleString()}, but ${target.label} = ${t.toLocaleString()} (Δ ${delta.toLocaleString()}).`);
      }
      return null;
    }

    case "less-than":
    case "less-than-or-equal":
    case "greater-than":
    case "greater-than-or-equal": {
      // Two evaluation modes:
      //   • Array `from` + numeric `operand` → "Σ(sources) ⋚ operand"
      //   • Single `from` (or no sources)    → "target ⋚ operand-or-source"
      const isArrayFrom = Array.isArray(edge.from) && edge.from.length > 1;
      let lhs: number;
      let rhs: number;
      let lhsLabel: string;
      let rhsLabel: string;
      if (isArrayFrom && edge.operand != null) {
        const numericSources = sources.filter(isNum);
        if (numericSources.length === 0) return null;
        lhs = numericSources.reduce((acc, s) => acc + num(s), 0);
        rhs = edge.operand;
        lhsLabel = `Σ(${sources.map((s) => s.label).join(" + ")}) = ${lhs.toLocaleString()}`;
        rhsLabel = `${rhs.toLocaleString()}`;
      } else {
        if (!isNum(target)) return null;
        lhs = num(target);
        rhs = edge.operand ?? (sources[0] && isNum(sources[0]) ? num(sources[0]) : NaN);
        lhsLabel = `${target.label} (${lhs.toLocaleString()})`;
        rhsLabel = `${Number.isFinite(rhs) ? rhs.toLocaleString() : "?"}`;
      }
      if (!Number.isFinite(rhs)) return null;
      const slack = tol(edge) * Math.max(1, Math.abs(rhs));
      const ok =
        edge.kind === "less-than" ? lhs < rhs + slack :
        edge.kind === "less-than-or-equal" ? lhs <= rhs + slack :
        edge.kind === "greater-than" ? lhs > rhs - slack :
        lhs >= rhs - slack;
      if (ok) return null;
      const sym =
        edge.kind === "less-than" ? "<" :
        edge.kind === "less-than-or-equal" ? "≤" :
        edge.kind === "greater-than" ? ">" : "≥";
      const involved = isArrayFrom
        ? [...sources.map((s) => s.id), target.id]
        : [target.id, ...sources.map((s) => s.id)];
      return mkViolation(edge, involved, Math.abs(lhs - rhs),
        `${lhsLabel} ${sym} ${rhsLabel} fails (Δ ${Math.abs(lhs - rhs).toLocaleString()}).`);
    }

    case "implies": {
      // Soft logical implication: if every source is "truthy" (numeric > 0
      // or boolean true or non-empty string), target must be too.
      const sourcesTruthy = sources.every(truthy);
      if (sourcesTruthy && !truthy(target)) {
        return mkViolation(edge, [...sources.map((s) => s.id), target.id], 1,
          `${sources.map((s) => s.label).join(" + ")} imply ${target.label}, but ${target.label} is empty / zero.`);
      }
      return null;
    }

    case "mutex": {
      const live = [target, ...sources].filter(truthy);
      if (live.length > 1) {
        return mkViolation(edge, live.map((a) => a.id), live.length,
          `Mutually exclusive: ${live.map((a) => a.label).join(", ")} cannot all be active.`);
      }
      return null;
    }

    case "ratio": {
      // operand is the target ratio (numerator / sum-of-sources).
      if (!isNum(target) || edge.operand == null) return null;
      const sum = sources.reduce((acc, s) => acc + (isNum(s) ? num(s) : 0), 0);
      if (sum === 0) return null;
      const observed = num(target) / sum;
      const delta = Math.abs(observed - edge.operand);
      if (delta > Math.max(tol(edge), 0.01)) {
        return mkViolation(edge, [...sources.map((s) => s.id), target.id], delta,
          `Ratio ${target.label}/Σ = ${(observed * 100).toFixed(1)}% deviates from target ${(edge.operand * 100).toFixed(1)}%.`);
      }
      return null;
    }

    default:
      return null;
  }
}

function truthy(a: Assertion): boolean {
  switch (a.value.type) {
    case "number": return a.value.value > 0;
    case "boolean": return a.value.value;
    case "string": return a.value.value.trim().length > 0;
    case "date": return !!a.value.value;
  }
}

function mkViolation(
  edge: ConstraintEdge,
  involved: AssertionId[],
  magnitude: number,
  message: string,
): Violation {
  return {
    constraintId: edge.id,
    severity: edge.severity,
    involved: [...new Set(involved)],
    magnitude,
    message: `${edge.rationale}: ${message}`,
  };
}

/**
 * Run the full lint pass. Returns every violation, hard or soft, in
 * deterministic order (by constraint id then magnitude).
 */
export function detectViolations(graph: DependencyGraph): Violation[] {
  const out: Violation[] = [];
  for (const edge of graph.listConstraints()) {
    const v = evaluate(graph, edge);
    if (v) out.push(v);
  }
  out.sort((a, b) =>
    a.severity === b.severity
      ? b.magnitude - a.magnitude
      : a.severity === "hard" ? -1 : 1,
  );
  return out;
}
