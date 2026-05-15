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
