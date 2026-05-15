/**
 * Counterforge — typed core.
 *
 * The skeptic engine that argues against your own draft using your
 * own corpus. Each `CounterCase` is "one claim of yours vs. the
 * strongest counter Forge could build for it."
 *
 * Lifecycle:
 *   open       — Counterforge surfaced this; user hasn't decided
 *   refuted    — user pasted a stronger source / argued back; closed
 *   conceded   — user added a caveat to the draft; closed
 *   deferred   — user keeps it open intentionally (e.g. "later")
 *   stale      — the underlying claim text changed; needs re-evaluation
 *
 * Readiness score = (refuted + conceded) / (refuted + conceded + open + deferred)
 * Stale cases are excluded from the denominator until re-scanned.
 */

import type { Timestamp } from "firebase/firestore";

export type CounterCaseStatus =
  | "open"
  | "refuted"
  | "conceded"
  | "deferred"
  | "stale";

export type CounterStrength = "weak" | "moderate" | "strong";

export interface CounterEvidence {
  /** Free-form snippet text that supports the counter. */
  text: string;
  /** Where the snippet came from — sourceId, URL, docId. */
  sourceRef?: string;
  /** Snippet kind for UI iconography. */
  kind: "snippet" | "claim" | "document" | "web";
  /** Strength of this single piece of evidence in isolation. */
  strength: CounterStrength;
}

export interface CounterCase {
  id: string;
  projectId: string;
  ownerId: string;

  /** The user's claim, verbatim — first 240 chars of the surrounding sentence. */
  claimText: string;
  /** Optional anchor back to a Forge claim row, if the extractor matched one. */
  claimId?: string;
  /** Optional anchor back to the document the claim was extracted from. */
  documentId?: string;
  /** Paragraph index inside the document for stable deep-linking. */
  paragraphIdx?: number;

  /** 2–3 sentence counter-argument Forge built. */
  counterArgument: string;
  /** Up to 5 supporting evidence rows. */
  evidence: CounterEvidence[];
  /** Aggregate counter strength after considering all evidence. */
  overallStrength: CounterStrength;

  status: CounterCaseStatus;

  /** Free-text note the user attaches when resolving. */
  resolution?: string;
  /** If conceded → the caveat text that was added to the draft. */
  concededCaveat?: string;
  /** If refuted → the source/argument that defeated the counter. */
  refutationSource?: string;

  /** Stable hash for dedup across re-scans. Composed of (claimText canonical
   *  form, projectId). Same claim → same fingerprint → don't re-create. */
  fingerprint: string;

  createdAt: Timestamp | number;
  updatedAt: Timestamp | number;
  resolvedAt?: Timestamp | number;
}

export interface CounterforgeRunSummary {
  newCases: number;
  rescoredStale: number;
  totalClaimsExamined: number;
  totalCounterEvidenceConsidered: number;
  durationMs: number;
}

export interface ReadinessScore {
  /** Cases addressed (refuted ∪ conceded) divided by total resolvable. */
  pct: number;
  refuted: number;
  conceded: number;
  open: number;
  deferred: number;
  stale: number;
  total: number;
}

/* ── Settings — per-project tuning ───────────────────────────── */

export interface CounterforgeSettings {
  projectId: string;
  ownerId: string;
  /** Auto-scan after this many minutes of inactivity. 0 = manual only. */
  autoScanIdleMinutes: number;
  /** Min raw counter-confidence required to surface a case. 0..1. */
  surfaceThreshold: number;
  /** Skip claims whose source-support is `strong` or `consensus`. */
  skipWellSupported: boolean;
  updatedAt: Timestamp | number;
}

export const DEFAULT_SETTINGS: Omit<
  CounterforgeSettings,
  "projectId" | "ownerId" | "updatedAt"
> = {
  autoScanIdleMinutes: 0,
  surfaceThreshold: 0.45,
  skipWellSupported: true,
};
