/**
 * Version history — types.
 *
 * A `Version` is a structured record of one mutation to the workspace.
 * Versions are append-only; the user never "deletes a version", they
 * "propose a restore" which creates a new version that undoes the
 * effect.
 *
 * Sources that emit Versions: Sync (patch applied), Pulse (refactor
 * accepted / rejected), Lattice (rebranch / subtask decompose), Calendar
 * (event create / update / delete), Tempo (replan), Habits (completed).
 *
 * The aggregator (versions/aggregator.ts) composes these streams into
 * a unified chronological feed.
 */

import type { LogicalPatch } from "../sync/types";
import type { RefactorProposal } from "../pulse/types";

export type VersionSource =
  | "sync.patch"
  | "pulse.refactor.accept"
  | "pulse.refactor.reject"
  | "lattice.rebranch"
  | "lattice.subtask.decompose"
  | "calendar.event.upsert"
  | "calendar.event.delete"
  | "tempo.replan"
  | "habit.completed"
  | "habit.undo";

export interface Version {
  id: string;
  /** What kind of change this was. */
  source: VersionSource;
  /** When the change landed. */
  at: number;
  /** Display title — "Applied patch · seniorTotalComp 660k → 600k". */
  title: string;
  /** One-line subtitle. */
  summary: string;
  /** Optional project id this version pertains to. */
  projectId?: string;
  /** Optional owner uid (we filter by this). */
  uid?: string;
  /** Free-form structured payload — never null. */
  detail: Record<string, unknown>;
  /** Whether the user can propose a restore for this version. */
  restorable: boolean;
}

/** Source-specific payload helpers — narrow the `detail` field. */
export interface SyncPatchVersionDetail {
  patchId: string;
  patchSummary: string;
  iterations: number;
  reachesStable: boolean;
  changeCount: number;
  patch?: LogicalPatch;
}

export interface PulseRefactorVersionDetail {
  blockId: string;
  documentId: string;
  proposalKind: RefactorProposal["kind"];
  triggers: string[];
  /** Decision: accepted or rejected (or skipped if we ever record that). */
  decision: "accept" | "reject" | "skip";
}

export interface LatticeRebranchVersionDetail {
  added: number;
  removed: number;
  statusChanged: number;
  draftsRefreshed: number;
  blocked: number;
}

export interface CalendarEventVersionDetail {
  eventId: string;
  eventKind: string;
  start: string;
  end: string;
  title: string;
}

/* ───────────── query + filter ───────────── */

export interface VersionFilter {
  sources?: VersionSource[];
  projectId?: string;
  from?: number;
  to?: number;
  /** Free-text substring match against title + summary. */
  search?: string;
  /** Max items returned (default 100). */
  limit?: number;
}

/* ───────────── store contract ───────────── */

export interface VersionStore {
  push(v: Omit<Version, "id">): Promise<Version>;
  list(filter?: VersionFilter): Promise<Version[]>;
  get(id: string): Promise<Version | null>;
  /**
   * "Propose a restore" — does NOT mutate state directly. Returns a
   * draft action the caller routes through the original system
   * (Sync patch flow, Pulse accept flow, etc.).
   */
  proposeRestore(id: string): Promise<RestoreProposal | null>;
}

export interface RestoreProposal {
  /** What the restore would do, in plain English. */
  description: string;
  /** Which source this restore targets. */
  source: VersionSource;
  /** The structured action payload to hand to the source's accept flow. */
  action: Record<string, unknown>;
  /** Whether the restore is safe to auto-apply or needs review. */
  safety: "safe" | "review-required";
}
