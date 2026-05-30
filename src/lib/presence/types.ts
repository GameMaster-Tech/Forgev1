/**
 * AI Presence Layer — type system + event schemas.
 *
 * The Presence Layer makes agent *intent* visible: every thing the AI is about
 * to do, is doing, or predicts it will do is reflected as a typed presence
 * state that the ghost cursor + overlay render. The agent never hides an
 * action; this module is the contract for that transparency.
 *
 * Pure types — safe to import from client and server.
 */

/* ───────────────────────── lifecycle ───────────────────────── */

/**
 * The agent's current phase. A deliberate, small state machine so the UI is
 * always in exactly one legible state.
 *
 *   idle          — nothing happening
 *   listening     — capturing speech / input
 *   understanding — parsing intent from a (partial) utterance
 *   navigating    — the ghost is moving toward a target (speculative or real)
 *   executing     — an action is running (tool call, mutation)
 *   confirming    — a preview is awaiting the user's yes/no
 *   waiting       — blocked on an external response (network, model)
 *   error         — last step failed; recoverable
 *   done          — a sequence completed (transient → idle)
 */
export type PresencePhase =
  | "idle"
  | "listening"
  | "understanding"
  | "navigating"
  | "executing"
  | "confirming"
  | "waiting"
  | "error"
  | "done";

/** Risk classification for any action the agent proposes. */
export type RiskLevel = "low" | "medium" | "high" | "critical";

/** A 0..1 confidence with a coarse band for quick visual encoding. */
export interface Confidence {
  value: number; // 0..1
  band: "low" | "medium" | "high";
}

export function toConfidence(value: number): Confidence {
  const v = Math.max(0, Math.min(1, value));
  return { value: v, band: v >= 0.75 ? "high" : v >= 0.45 ? "medium" : "low" };
}

/* ───────────────────────── targets / spatial ───────────────────────── */

/** A resolved on-screen target the ghost cursor can move to. */
export interface PresenceTarget {
  /** Stable id when available (data-presence-id), else a synthesized one. */
  id: string;
  /** Viewport-space rect (px). */
  rect: { x: number; y: number; width: number; height: number };
  /** Human label for the overlay ("Archive", "Q3 doc", "Assignee field"). */
  label?: string;
  /** What kind of thing it is, for the action trail. */
  kind?: "nav" | "field" | "card" | "button" | "doc" | "region";
}

/** What the user might be referring to with "this" / "that" / "selected". */
export type SpatialReference =
  | "this"
  | "that"
  | "it"
  | "selected"
  | "selection"
  | "current"
  | "current card"
  | "current doc"
  | "hovered"
  | "focused";

/** Snapshot of where the user's attention is, for reference resolution. */
export interface SpatialContext {
  cursor: { x: number; y: number } | null;
  hoveredId: string | null;
  selectedId: string | null;
  focusedId: string | null;
  /** Plain-text current text selection, if any. */
  textSelection: string | null;
  viewport: { width: number; height: number; scrollY: number };
  at: number; // ms epoch
}

/* ───────────────────────── intent ───────────────────────── */

/** A predicted intent derived from a (possibly partial) utterance/command. */
export interface PredictedIntent {
  /** Canonical verb the workspace understands. */
  action:
    | "navigate"
    | "open"
    | "create"
    | "extract"
    | "assign"
    | "delete"
    | "summarize"
    | "search"
    | "unknown";
  /** Free-text label shown live ("Opening Q3 marketing strategy"). */
  label: string;
  /** Resolved/raw target phrase ("the Q3 marketing strategy", "this"). */
  targetPhrase?: string;
  /** Optional route this intent would navigate to (speculative nav). */
  route?: string;
  confidence: Confidence;
  /** True while the utterance is still streaming (interim transcript). */
  partial: boolean;
  /** Source words that produced this prediction. */
  transcript: string;
}

/* ───────────────────────── action trail ───────────────────────── */

export interface TrailAction {
  id: string;
  label: string;
  phase: PresencePhase;
  status: "predicted" | "active" | "done" | "failed" | "skipped";
  at: number;
  confidence?: Confidence;
  targetId?: string;
}

/* ───────────────────────── confirmation ───────────────────────── */

export interface AffectedEntity {
  id: string;
  label: string;
  kind: "doc" | "project" | "task" | "event" | "card" | "field" | "other";
}

export interface ConfirmationRequest {
  id: string;
  /** Short imperative summary ("Delete 3 archived docs"). */
  summary: string;
  risk: RiskLevel;
  affected: AffectedEntity[];
  /** One-line estimated impact ("Frees ~12 cards · reversible for 10s"). */
  impact?: string;
  /** Whether an undo is available after applying. */
  undoable: boolean;
  /** Render inline next to a target instead of a corner toast. */
  anchorTargetId?: string;
  createdAt: number;
  /** Auto-dismiss (ignore) after N ms of no decision (0 = never). */
  autoDismissMs: number;
}

export type ConfirmationDecision = "confirm" | "cancel" | "dismiss";

/* ───────────────────────── event bus schema ───────────────────────── */

/**
 * Discriminated union for the presence event stream. The store is the bus;
 * a WebSocket transport (server-driven presence / multi-client) serialises
 * exactly these shapes — see docs in PresenceLayer.
 */
export type PresenceEvent =
  | { type: "phase"; phase: PresencePhase; at: number }
  | { type: "intent"; intent: PredictedIntent | null; at: number }
  | { type: "target"; target: PresenceTarget | null; at: number }
  | { type: "action.start"; action: TrailAction; at: number }
  | { type: "action.done"; id: string; status: TrailAction["status"]; at: number }
  | { type: "confirm.request"; request: ConfirmationRequest; at: number }
  | { type: "confirm.resolve"; id: string; decision: ConfirmationDecision; at: number }
  | { type: "error"; message: string; at: number }
  | { type: "reset"; at: number };

/** Color/semantics per phase — single source of truth for the UI. */
export const PHASE_META: Record<
  PresencePhase,
  { label: string; tone: string; dot: string }
> = {
  idle: { label: "Idle", tone: "text-muted", dot: "bg-muted/40" },
  listening: { label: "Listening", tone: "text-cyan", dot: "bg-cyan" },
  understanding: { label: "Understanding", tone: "text-violet", dot: "bg-violet" },
  navigating: { label: "Navigating", tone: "text-violet", dot: "bg-violet" },
  executing: { label: "Executing", tone: "text-violet", dot: "bg-violet" },
  confirming: { label: "Confirm?", tone: "text-warm", dot: "bg-warm" },
  waiting: { label: "Waiting", tone: "text-muted", dot: "bg-muted/60" },
  error: { label: "Error", tone: "text-rose", dot: "bg-rose" },
  done: { label: "Done", tone: "text-green", dot: "bg-green" },
};

export const RISK_META: Record<RiskLevel, { label: string; tone: string; ring: string }> = {
  low: { label: "Low", tone: "text-green", ring: "border-green/40" },
  medium: { label: "Medium", tone: "text-cyan", ring: "border-cyan/40" },
  high: { label: "High", tone: "text-warm", ring: "border-warm/40" },
  critical: { label: "Critical", tone: "text-rose", ring: "border-rose/50" },
};
