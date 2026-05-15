/**
 * Lattice — Recursive Task Decomposition Engine.
 *
 * Type contract.
 *
 * Conceptual model
 * ─────────────────
 *   ProjectContext  — frozen snapshot of the project: every assertion
 *                     Pulse/Sync know about, plus every prose
 *                     ContentBlock. Lattice never reads Firestore
 *                     directly — callers pass a context and the engine
 *                     stays headless and pure.
 *
 *   TaskTree        — flat map of `AtomicSubtask`s + parent/child
 *                     adjacency. Single root (the user's top-level
 *                     goal). Always acyclic — `decomposeTask()` rejects
 *                     edges that would close a cycle.
 *
 *   AtomicSubtask   — the leaf unit. Carries a `resolutionCondition`
 *                     (logic-gate over project state) and a
 *                     `draftOutcome` (pre-computed body the user can
 *                     "verify & commit").
 *
 *   Watcher         — long-lived controller. Reads a `ProjectContext`
 *                     source, debounces change events, re-runs
 *                     decomposition, and emits a `RebranchResult`
 *                     describing what got added / removed / mutated.
 *
 * Concurrency
 * ───────────
 *   • All evaluators are pure; given the same (tree, context) they
 *     return the same statuses.
 *   • `Watcher` is single-flight: incoming events queue while a
 *     rebranch is mid-flight; the queue collapses to the latest
 *     context.
 *
 * Termination
 * ───────────
 *   • Decomposition cap: `MAX_TREE_DEPTH` (default 5).
 *   • Atomic-subtask cap per parent: `MAX_FANOUT` (default 12).
 *   • Resolver iteration cap: 1 (statuses are computed in one
 *     bottom-up pass; composite conditions cannot recursively trigger
 *     decomposition).
 */

import type { Assertion, AssertionId, DocumentId, AssertionValue } from "../sync/types";
import type { ContentBlock } from "../pulse/types";

/* ───────────── identifiers ───────────── */

export type TaskId = string;
export type ConditionId = string;

/* ───────────── status model ───────────── */

/**
 * Task lifecycle.
 *
 *   pending      — not yet actionable / not yet attempted
 *   in_progress  — user has explicitly started it
 *   blocked      — a dependency or condition cannot be evaluated
 *                  (orphan assertion, deleted document)
 *   complete     — `resolutionCondition` evaluated to true under the
 *                  current project context
 *   irrelevant   — decomposition no longer requires this subtask
 *                  (kept around for one rebranch cycle so the UI can
 *                  show "removed by Lattice on <date>")
 *   user-locked  — the user committed an explicit status that the
 *                  resolver must not override
 */
export type TaskStatus =
  | "pending"
  | "in_progress"
  | "blocked"
  | "complete"
  | "irrelevant"
  | "user-locked";

export interface StatusHistoryEntry {
  status: TaskStatus;
  at: number;
  /** "resolver" | "watcher" | "user" | "decompose". */
  by: "resolver" | "watcher" | "user" | "decompose";
  reason?: string;
}

/* ───────────── resolution conditions ───────────── */

export type ResolutionCondition =
  | AssertionExistsCondition
  | AssertionFreshCondition
  | AssertionValueCondition
  | DocumentSectionCondition
  | DocumentMentionsCondition
  | TaskCompleteCondition
  | CompositeAndCondition
  | CompositeOrCondition
  | ManualCondition;

export interface AssertionExistsCondition {
  id: ConditionId;
  kind: "assertion-exists";
  /** Required assertion key, e.g. "engineering.senior.salary". */
  assertionKey: string;
}

export interface AssertionFreshCondition {
  id: ConditionId;
  kind: "assertion-fresh";
  assertionKey: string;
  /** Trust must be ≥ this. 0..1. Defaults to 0.5. */
  minTrust?: number;
  /** Optional max age in days; mirrors Pulse's freshness model. */
  maxAgeDays?: number;
}

export interface AssertionValueCondition {
  id: ConditionId;
  kind: "assertion-value";
  assertionKey: string;
  /** Inclusive numeric range. */
  range?: { min?: number; max?: number };
  /** Exact-match list (any-of). */
  oneOf?: AssertionValue["value"][];
  /** Free-form predicate. Receives the live assertion. */
  predicate?: (a: Assertion) => boolean;
}

export interface DocumentSectionCondition {
  id: ConditionId;
  kind: "document-section";
  documentId: DocumentId;
  /** Markdown heading the doc must contain (case-insensitive). */
  headingMatches: string;
}

export interface DocumentMentionsCondition {
  id: ConditionId;
  kind: "document-mentions";
  documentId: DocumentId;
  /** Phrase (regex string) the body must contain. */
  pattern: string;
  /** Case-insensitive search? Default true. */
  caseInsensitive?: boolean;
}

export interface TaskCompleteCondition {
  id: ConditionId;
  kind: "task-complete";
  taskId: TaskId;
}

export interface CompositeAndCondition {
  id: ConditionId;
  kind: "and";
  conditions: ResolutionCondition[];
}

export interface CompositeOrCondition {
  id: ConditionId;
  kind: "or";
  conditions: ResolutionCondition[];
}

export interface ManualCondition {
  id: ConditionId;
  kind: "manual";
  /** Optional reminder text shown next to the "Mark done" button. */
  hint?: string;
}

/* ───────────── drafts ───────────── */

export interface DraftAssertionWrite {
  /** Key the draft proposes to write. May or may not already exist. */
  key: string;
  documentId: DocumentId;
  /** Proposed new value. */
  value: AssertionValue;
  kind: Assertion["kind"];
  /** Trust the engine wants to stamp on the write. 0..1. */
  confidence: number;
  /** Free-form source description ("market lookup", "user input"). */
  source: string;
}

export interface DraftOutcome {
  /** Markdown body the user can paste into the doc as-is. */
  body: string;
  /** Concrete writes the user can commit in one step. */
  writes: DraftAssertionWrite[];
  /**
   * 0..1 confidence. Falls when required inputs are missing or stale,
   * climbs when oracles return narrow bands.
   */
  confidence: number;
  generatedAt: number;
  /** Assertions Lattice actually read to synthesise this draft. */
  citedAssertionIds: AssertionId[];
  /** Reason this draft might be wrong — surfaced in the UI. */
  caveats: string[];
}

/* ───────────── subtask ───────────── */

export interface AtomicSubtask {
  id: TaskId;
  parentId: TaskId | null;
  title: string;
  /** Optional longer prose for the task card. */
  description?: string;
  status: TaskStatus;
  /** When user-locked, this overrides the resolver. */
  userLocked: boolean;
  resolutionCondition: ResolutionCondition;
  draftOutcome?: DraftOutcome;
  /** 0 for the root, 1 for its children, etc. Used for cap enforcement. */
  depth: number;
  /**
   * Stable "decomposition signature". When the parser re-decomposes a
   * task and produces a subtask with the same signature, the existing
   * record is merged with the new one (preserving user edits).
   */
  signature: string;
  createdAt: number;
  updatedAt: number;
  /** Set when rebranch marks it irrelevant; absent otherwise. */
  removedAt?: number;
  /** Assertion keys this task touches. Used by the watcher's diff. */
  boundAssertionKeys: string[];
  /** Document ids this task touches. */
  boundDocumentIds: DocumentId[];
  history: StatusHistoryEntry[];
  /** Optional ordered list of preceding sibling ids. */
  prerequisites: TaskId[];
  /** Optional tag the parser used. */
  intentTag?: string;
}

/* ───────────── tree ───────────── */

export interface TaskTree {
  projectId: string;
  rootId: TaskId;
  /** Flat lookup. */
  tasks: Map<TaskId, AtomicSubtask>;
  /** parent → children, in declared order. */
  childrenOf: Map<TaskId, TaskId[]>;
  /** Last touched. */
  updatedAt: number;
}

/* ───────────── project context ───────────── */

export interface ProjectContext {
  projectId: string;
  /** Snapshot at `as-of`. */
  assertions: Assertion[];
  documents: ProjectDocument[];
  blocks: ContentBlock[];
  /**
   * Optional flat-text dump. The parser falls back to this when no
   * structured assertions match the task. Useful for unstructured
   * research notes.
   */
  unstructuredText?: string;
  asOf: number;
}

export interface ProjectDocument {
  id: DocumentId;
  title: string;
  body: string;        // markdown
  updatedAt: number;
}

/* ───────────── decomposition ───────────── */

export interface DecomposeOptions {
  /** Max tree depth. Default 5. */
  maxDepth?: number;
  /** Max children per parent. Default 12. */
  maxFanout?: number;
  /** When true, preserve existing subtasks whose signature still appears. */
  preserveExisting?: boolean;
  /** Override "now" for deterministic tests. */
  now?: number;
}

export interface DecompositionPlan {
  rootIntent: ParsedIntent;
  /** Subtasks the parser believes should exist for this parent. */
  proposed: ProposedSubtask[];
}

export interface ProposedSubtask {
  signature: string;
  title: string;
  description?: string;
  intentTag: string;
  resolutionCondition: ResolutionCondition;
  draftOutcome?: DraftOutcome;
  boundAssertionKeys: string[];
  boundDocumentIds: DocumentId[];
  prerequisites: number[]; // indices into the proposed list
}

/* ───────────── parsed intent ───────────── */

export type IntentKind =
  | "hire"
  | "launch"
  | "research"
  | "budget"
  | "policy"
  | "report"
  | "deadline"
  | "generic";

export interface ParsedIntent {
  kind: IntentKind;
  /** Raw verb the parser saw. */
  verb: string;
  /** What the verb acts on. "senior engineers", "investor update", etc. */
  object: string;
  /** Numeric quantifier if present ("hire 4 engineers" → 4). */
  quantity?: number;
  /** ISO date if a deadline was extracted. */
  byDate?: string;
  /** Tokens we couldn't classify. Surfaced as caveats. */
  unresolved: string[];
  /** 0..1 — how sure we are about the intent kind. */
  confidence: number;
}

/* ───────────── rebranch ───────────── */

export interface RebranchResult {
  added: TaskId[];
  /** Marked irrelevant; not deleted in this cycle. */
  removed: TaskId[];
  /** Existing tasks whose status changed. */
  statusChanged: { id: TaskId; from: TaskStatus; to: TaskStatus }[];
  /** Existing tasks whose draft was re-synthesised. */
  draftsRefreshed: TaskId[];
  /** Tasks the resolver couldn't classify ⇒ blocked. */
  blocked: TaskId[];
  ranAt: number;
}

/* ───────────── watcher ───────────── */

export type WatcherEvent =
  | { kind: "assertion-upsert"; assertionId: AssertionId; key: string }
  | { kind: "assertion-delete"; assertionId: AssertionId; key: string }
  | { kind: "document-upsert"; documentId: DocumentId }
  | { kind: "document-delete"; documentId: DocumentId }
  | { kind: "context-replace" };

export interface WatcherOptions {
  /** Coalesce bursts of events within this window (ms). Default 200. */
  debounceMs?: number;
  /** Refresh drafts even when no signature changed. Default true. */
  refreshDraftsOnAnyChange?: boolean;
}

export interface WatcherController {
  /** Push an event; the watcher will run a single rebranch after debounce. */
  push: (event: WatcherEvent) => void;
  /** Force a rebranch now. */
  flush: () => Promise<RebranchResult | null>;
  /** Subscribe to rebranch results. Returns an unsubscribe. */
  subscribe: (handler: (r: RebranchResult) => void) => () => void;
  /** Last known tree. */
  getTree: () => TaskTree;
  /** Stop the watcher and reject any pending timers. */
  dispose: () => void;
}
