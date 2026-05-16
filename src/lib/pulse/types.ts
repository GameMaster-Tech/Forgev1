/**
 * Pulse — temporal entropy / truth-decay engine.
 *
 * Every stored assertion has a half-life: the older it gets relative to
 * its half-life, the lower its trust. Pulse runs a scheduled
 * Reality-Sync that re-fetches a value from a live-data mock, diffs it
 * against the workspace truth, and — when the gap exceeds a threshold —
 * marks the assertion Invalidated and emits a refactored content block.
 *
 * Pure data layer; no DOM, no network. Reality-fetch is injected.
 */

import type { Assertion, AssertionId } from "../sync/types";

/* ───────────── Decay ───────────── */

export interface DecayProfile {
  /** Days until trust drops by 50%. */
  halfLifeDays: number;
  /** Trust floor; assertions never go below this purely from age. */
  floor: number;
  /** Trust ceiling at age zero. */
  ceiling: number;
}

/** A snapshot of a single assertion's trust at a moment in time. */
export interface TrustSnapshot {
  assertionId: AssertionId;
  ageDays: number;
  trust: number; // 0..1
  halfLifeDays: number;
  willInvalidateAt?: string; // ISO, when trust crosses the invalidate-threshold
}

/* ───────────── Reality oracle ───────────── */

export interface RealityReading {
  /** What we believe is currently true in the outside world. */
  value: Assertion["value"];
  asOf: string; // ISO
  source: string;
  /** 0..1, how trustworthy the live reading itself is. */
  confidence: number;
}

/**
 * Pluggable oracle. The product wires this to the market mock today;
 * later it can point at real APIs, an internal data lake, or a Slack
 * bot's announcement digest.
 */
export type RealityOracle = (assertion: Assertion) => Promise<RealityReading | null>;

/* ───────────── multi-oracle composition ───────────── */

/**
 * One leg of a multi-oracle composition. The same shape as the
 * `RealityReading` produced by a single oracle, plus identity fields so
 * the UI can show each leg's contribution.
 */
export interface OracleContribution {
  /** Unique oracle id (`market`, `policy`, etc.). */
  oracleId: string;
  /** Human-readable name surfaced in the UI. */
  oracleName: string;
  /** This oracle's priority weight (≥0). Higher = more influence. */
  priority: number;
  /** The reading the oracle returned. */
  reading: RealityReading;
}

/**
 * A registered oracle. A `match` function decides whether the oracle
 * applies to an assertion; `priority` is the weight used when blending
 * multiple matching oracles for the same assertion.
 */
export interface RegisteredOracle {
  id: string;
  name: string;
  /** Higher priorities dominate blends. Must be > 0. Default 1. */
  priority: number;
  /** Pure predicate over (kind, tag). Cheap; called once per assertion. */
  match: (input: { kind: Assertion["kind"]; tag?: string; assertion: Assertion }) => boolean;
  /** Async fetch. Should return null when the oracle can't speak. */
  fetch: (assertion: Assertion) => Promise<RealityReading | null>;
}

export interface OracleRegistry {
  register: (oracle: RegisteredOracle) => void;
  unregister: (id: string) => void;
  list: () => RegisteredOracle[];
  /** Resolve every oracle that claims `assertion`. */
  matching: (assertion: Assertion) => RegisteredOracle[];
  /** Fetch from every matching oracle and return per-oracle contributions. */
  query: (assertion: Assertion) => Promise<OracleContribution[]>;
  /**
   * Convenience: produce a single `RealityOracle` callable that blends
   * matching contributions via priority-weighted average.
   */
  asOracle: () => RealityOracle;
}

/* ───────────── Reality-Diff ───────────── */

export type DiffStatus = "fresh" | "stale" | "invalidated";

export interface RealityDiff {
  assertionId: AssertionId;
  workspaceValue: Assertion["value"];
  realityValue: Assertion["value"] | null;
  /** Absolute delta (numbers only); 0/1 for categorical. */
  delta: number;
  /** delta / |workspace| when numeric; otherwise 0..1. */
  driftRatio: number;
  status: DiffStatus;
  /** Trust at the moment of comparison. */
  trustBefore: number;
  /** Trust after — drops to 0 when invalidated. */
  trustAfter: number;
  realitySource?: string;
  realityAsOf?: string;
  /** Plain-English explanation. */
  message: string;
  /**
   * Optional breakdown when multiple oracles contributed to the diff.
   * Empty / undefined for legacy single-oracle runs.
   */
  contributions?: OracleContribution[];
}

/* ───────────── Refactor ───────────── */

export interface ContentBlock {
  /** Stable id so the editor can patch the document in place. */
  id: string;
  documentId: string;
  /** Markdown body — what the user is actually reading. */
  body: string;
  /** Assertions referenced by this block. */
  referencedAssertionIds: AssertionId[];
}

export interface RefactorProposal {
  blockId: string;
  documentId: string;
  before: string;
  after: string;
  /** Why we suggested this rewrite — links the diffs that triggered it. */
  triggeredBy: AssertionId[];
  /** Whether the change is purely a number swap (safe) or text rewrite (review). */
  kind: "value-swap" | "text-rewrite";
}

/* ───────────── Scheduling ───────────── */

export type Cadence = "manual" | "daily" | "weekly" | "monthly";

export interface SyncRun {
  id: string;
  projectId: string;
  cadence: Cadence;
  ranAt: string;
  diffs: RealityDiff[];
  invalidatedCount: number;
  staleCount: number;
  freshCount: number;
  refactorProposals: RefactorProposal[];
}

export interface PulseConfig {
  projectId: string;
  cadence: Cadence;
  /** drift ratio above which we flag invalidated. e.g. 0.10 = 10%. */
  invalidateThreshold: number;
  /** drift ratio above which we flag stale. */
  staleThreshold: number;
  /** Optional decay overrides per AssertionKind. */
  defaultProfile: DecayProfile;
}
