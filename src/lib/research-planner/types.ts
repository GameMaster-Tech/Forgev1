/**
 * Research Planner — typed core.
 *
 * Three persisted shapes:
 *
 *   Suggestion       — surfaced gap Forge thinks the user should investigate
 *   PlanItem         — accepted suggestion turned into an active research item
 *   PlannerWeights   — per-project preference learning state
 *
 * Hard rule: a Suggestion only becomes a PlanItem after the user
 * accepts. Forge NEVER creates a PlanItem on its own.
 *
 * Detection is deterministic from the project's existing artefacts
 * (veritasClaims, documents, queries, veritasContradictions). The
 * scan never reads outside the project boundary.
 */

import type { Timestamp } from "firebase/firestore";

/* ── Suggestion ──────────────────────────────────────────────── */

export type SuggestionKind =
  /** A claim in the project's graph has too few supporting sources. */
  | "undersupported-claim"
  /** Active document content discusses a topic the project has read
   *  shallowly on (low claim/source/snippet density for that topic). */
  | "underread-topic"
  /** Two claims contradict and the conflict is unresolved. */
  | "contradiction";

export type SuggestionStatus = "pending" | "accepted" | "dismissed";

export interface Suggestion {
  id: string;
  projectId: string;
  ownerId: string;

  kind: SuggestionKind;
  status: SuggestionStatus;

  /** One-line headline rendered in the card. */
  title: string;
  /** 1–3 sentences explaining the gap and why it matters. */
  rationale: string;
  /** What Forge proposes the user *do* — verbatim text used as the
   *  plan-item title on accept. */
  proposedAction: string;

  /** Stable hash of the suggestion's content. Re-running the scan
   *  with no new data produces an identical fingerprint, so we de-
   *  duplicate against `pending` + `dismissed` rows by this key. */
  fingerprint: string;

  /** Kind-specific references back into the project graph. Only the
   *  fields applicable to `kind` are filled. */
  refs: {
    claimId?: string;
    claimText?: string;
    topic?: string;
    documentId?: string;
    rivalClaimId?: string;
  };

  /** Detector confidence in [0, 1]. Used for ordering before the
   *  learned weights kick in. */
  rawScore: number;
  /** rawScore × learned_kind_weight, recomputed each render. */
  weightedScore: number;

  createdAt: Timestamp | number;
  decidedAt?: Timestamp | number;
}

/* ── Plan item ──────────────────────────────────────────────── */

export type PlanItemStatus = "open" | "in-progress" | "done" | "archived";

export interface PlanItem {
  id: string;
  projectId: string;
  ownerId: string;

  title: string;
  notes?: string;
  status: PlanItemStatus;

  /** When the item was created by accepting a suggestion, we keep
   *  the suggestion's kind + refs so the planner can deep-link back
   *  to the underlying claim/topic/contradiction. */
  origin: "suggestion" | "manual";
  sourceSuggestionId?: string;
  kind?: SuggestionKind;
  refs?: Suggestion["refs"];

  createdAt: Timestamp | number;
  updatedAt: Timestamp | number;
  completedAt?: Timestamp | number;
}

/* ── Learning weights ───────────────────────────────────────── */

/**
 * Per-project, per-kind acceptance learning. Stored as a small doc
 * keyed by `projectId`. The orchestrator multiplies a suggestion's
 * `rawScore` by `weight(kind)` to get `weightedScore`.
 *
 * Weights live in [WEIGHT_FLOOR, WEIGHT_CEILING]. Updates:
 *
 *   accept:  weight *= (1 + ACCEPT_BUMP)   capped at ceiling
 *   dismiss: weight *= (1 - DISMISS_DROP)  floored at floor
 *
 * Multiplicative is deliberate — a sequence of dismisses geometrically
 * suppresses a kind the user clearly doesn't care about, instead of
 * arithmetic creep that takes 50 dismisses to mute.
 */
export interface PlannerWeights {
  projectId: string;
  ownerId: string;
  weights: Record<SuggestionKind, number>;
  /** Per-kind counts kept for transparency + the planner's
   *  "Forge has learned…" footer. */
  acceptCounts: Record<SuggestionKind, number>;
  dismissCounts: Record<SuggestionKind, number>;
  updatedAt: Timestamp | number;
}

export const DEFAULT_KIND_WEIGHT = 1.0;
export const WEIGHT_FLOOR = 0.05;
export const WEIGHT_CEILING = 2.0;
export const ACCEPT_BUMP = 0.15;
export const DISMISS_DROP = 0.20;

export const ALL_KINDS: SuggestionKind[] = [
  "undersupported-claim",
  "underread-topic",
  "contradiction",
];

/* ── Scan result envelope ───────────────────────────────────── */

export interface ScanResult {
  newlyPersisted: number;
  dedupedAgainstPending: number;
  dedupedAgainstDismissed: number;
  totalDetected: number;
}
