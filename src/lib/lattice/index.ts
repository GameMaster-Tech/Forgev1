/**
 * Public Lattice API.
 *
 *   import { decomposeTask, resolveTree, createWatcher, parseIntent } from "@/lib/lattice";
 */

export type {
  AssertionExistsCondition,
  AssertionFreshCondition,
  AssertionValueCondition,
  AtomicSubtask,
  CompositeAndCondition,
  CompositeOrCondition,
  ConditionId,
  DecomposeOptions,
  DecompositionPlan,
  DocumentMentionsCondition,
  DocumentSectionCondition,
  DraftAssertionWrite,
  DraftOutcome,
  IntentKind,
  ManualCondition,
  ParsedIntent,
  ProjectContext,
  ProjectDocument,
  ProposedSubtask,
  RebranchResult,
  ResolutionCondition,
  StatusHistoryEntry,
  TaskCompleteCondition,
  TaskId,
  TaskStatus,
  TaskTree,
  WatcherController,
  WatcherEvent,
  WatcherOptions,
} from "./types";

export { parseIntent, intentSignature } from "./parser";
export { evaluateCondition, decideStatus, resolveTree, cloneTree } from "./resolve";
export type { ConditionVerdict, ResolverOptions, StatusDecision } from "./resolve";
export { synthesizeDraft } from "./draft";
export type { DraftRequest } from "./draft";
export { decomposeTask, pruneTree, orCond } from "./decompose";
export type { DecomposeResult } from "./decompose";
export { createWatcher } from "./watcher";
export type { CreateWatcherArgs } from "./watcher";
export { buildDemoContext, DEMO_PARENT_TASKS } from "./demo";

export {
  deleteTaskDoc,
  deserializeTask,
  reconcile,
  serializeTask,
  subscribeTree,
  writeTask,
  writeTree,
} from "./persistence";
export type { SubscribeOptions, WriteOptions } from "./persistence";
