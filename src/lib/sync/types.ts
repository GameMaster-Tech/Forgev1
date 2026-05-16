/**
 * Sync — cross-document constraint engine.
 *
 * Treats every quantitative or categorical commitment inside a project
 * (salary, headcount, runway, deadline, etc.) as an `Assertion`. Documents
 * become `DocumentNode`s holding ordered assertion ids. Constraints between
 * assertions are explicit edges in a `DependencyGraph`. The Logic-Linter
 * walks the graph, evaluates each constraint, and emits `Violation`s when
 * the workspace is internally inconsistent — i.e. not in a Stable State.
 *
 * Headless, fully typed, UI-agnostic.
 */

export type AssertionId = string;
export type DocumentId = string;
export type ConstraintId = string;

/**
 * The intent behind a number. Used by detectors to pick the right
 * market-data oracle when proposing a patch.
 */
export type AssertionKind =
  | "salary.annual"
  | "headcount"
  | "budget.total"
  | "budget.lineitem"
  | "runway.months"
  | "timeline.deadline"
  | "rate.percent"
  | "rate.hourly"
  | "fact.numeric"
  | "fact.categorical";

export type AssertionValue =
  | { type: "number"; value: number; unit?: string }
  | { type: "string"; value: string }
  | { type: "date"; value: string /* ISO */ }
  | { type: "boolean"; value: boolean };

/**
 * A single atomic, addressable commitment inside the workspace.
 * The (documentId, key) pair is unique per project; `id` is opaque.
 */
export interface Assertion {
  id: AssertionId;
  projectId: string;
  documentId: DocumentId;
  /** Stable dotted key, e.g. "engineering.senior.salary". */
  key: string;
  /** Human-readable label for the UI. */
  label: string;
  kind: AssertionKind;
  value: AssertionValue;
  /** When the value was last asserted by the user or the engine. */
  sourcedAt: number;
  /** Free-form provenance — "Q3 budget memo", "market lookup 2026-05-12". */
  source?: string;
  /** Confidence at write-time, 0..1. Decay is handled separately by Pulse. */
  confidence: number;
  /** Whether the value is locked by the user (won't be auto-patched). */
  locked?: boolean;
}

/**
 * Constraint kinds the detector understands. Soft constraints can be
 * relaxed by Sync; hard constraints must be satisfied or remain a
 * violation.
 */
export type ConstraintKind =
  | "equals"
  | "sum-equals"
  | "less-than"
  | "less-than-or-equal"
  | "greater-than"
  | "greater-than-or-equal"
  | "implies"
  | "mutex"
  | "ratio"
  | "between"
  | "not-equals"
  | "divisible-by";

export interface ConstraintEdge {
  id: ConstraintId;
  projectId: string;
  /** Originating side — usually the "ground truth" or aggregate. */
  from: AssertionId | AssertionId[];
  /** Dependent side — what must satisfy the rule. */
  to: AssertionId;
  kind: ConstraintKind;
  /** Optional numeric tolerance (e.g. "headcount × salary ≤ budget + 5%"). */
  tolerance?: number;
  /** Optional constant operand (e.g. less-than 12 months). */
  operand?: number;
  /** Optional lower bound; used by `between` (inclusive). */
  lowerBound?: number;
  /** Optional upper bound; used by `between` (inclusive). */
  upperBound?: number;
  /** Optional divisor; used by `divisible-by`. */
  divisor?: number;
  /** "hard" violations halt the solver; "soft" let it propose a patch. */
  severity: "hard" | "soft";
  /** Human-readable rationale for the rule. */
  rationale: string;
}

export interface DocumentNode {
  id: DocumentId;
  projectId: string;
  title: string;
  type:
    | "budget"
    | "hiring-plan"
    | "roadmap"
    | "policy"
    | "research-note"
    | "spec"
    | "generic";
  assertionIds: AssertionId[];
}

/* ───────────── Detection & patching ───────────── */

export interface Violation {
  constraintId: ConstraintId;
  severity: "hard" | "soft";
  /** Plain-English explanation: "Hiring plan needs 4 senior engineers at $230k, but Budget only allots $720k". */
  message: string;
  /** Assertions implicated, ordered by blame share (highest first). */
  involved: AssertionId[];
  /** A numeric measure of how far off we are. Higher = worse. */
  magnitude: number;
}

export interface ProposedChange {
  assertionId: AssertionId;
  before: AssertionValue;
  after: AssertionValue;
  /** Why the engine chose this new value (market data, balancing, etc.). */
  rationale: string;
  /** 0..1 — how confident the engine is in the proposed value. */
  confidence: number;
  /** When the change uses a market lookup, the oracle key. */
  marketRef?: string;
}

/**
 * A bundle of proposed changes that — applied atomically — drives the
 * workspace to a Stable State. The solver returns one of these from
 * `proposePatch()`.
 */
export interface LogicalPatch {
  id: string;
  projectId: string;
  generatedAt: number;
  /** Violations resolved by applying this patch. */
  resolves: Violation[];
  changes: ProposedChange[];
  /** Iterations the solver needed to converge. */
  iterations: number;
  /** True if the post-patch graph has zero hard violations. */
  reachesStableState: boolean;
  /** Net workspace delta — e.g. "+$130k payroll, +2 months runway". */
  summary: string;
}

export interface StabilityReport {
  projectId: string;
  isStable: boolean;
  hardViolations: number;
  softViolations: number;
  assertionsChecked: number;
  constraintsChecked: number;
  /** ISO timestamp of the lint run. */
  ranAt: string;
}
