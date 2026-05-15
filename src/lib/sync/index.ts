/**
 * Public Sync API. Consumers should import only from here.
 *
 *   import { DependencyGraph, proposePatch, applyPatch, checkStability } from "@/lib/sync";
 */

export type {
  Assertion,
  AssertionId,
  AssertionKind,
  AssertionValue,
  ConstraintEdge,
  ConstraintId,
  ConstraintKind,
  DocumentId,
  DocumentNode,
  LogicalPatch,
  ProposedChange,
  StabilityReport,
  Violation,
} from "./types";

export { DependencyGraph } from "./graph";
export { detectViolations, evaluate } from "./detect";
export { proposePatch, applyPatch, checkStability } from "./solver";
export type { SolverOptions } from "./solver";
export { lookup as marketLookup, marketRef } from "./market";
export type { MarketQuote, MarketQuery } from "./market";

// Demo fixtures — a Budget vs Hiring paradox the UI can render out of the box.
export { buildDemoGraph } from "./demo";
