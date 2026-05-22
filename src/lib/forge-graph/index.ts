/**
 * Forge Reactive Workspace — public barrel.
 *
 * Phase 1 (Adapter Layer)         — types, adapters, builder, invariants.
 * Phase 2 (Sandbox + Semantic)    — compiler, LLM proxies.
 * Phase 3 (Tempo)                 — tempo engine.
 * Phase 4 (Invariant Asserter UI) — invariant builder + persistence.
 *
 * All public APIs the rest of the app consumes are re-exported here.
 */

export * from "./types";
export {
  buildForgeGraph,
  topoSort,
  type BuildGraphInput,
} from "./builder";
export {
  documentNodeId,
  documentsToNodes,
  documentToNode,
} from "./adapters/documents";
export {
  assertionNodeId,
  assertionsToNodes,
  type AssertionAdapterInput,
} from "./adapters/assertions";
export {
  calendarEventNodeId,
  calendarEventsToNodes,
  calendarEventToNode,
} from "./adapters/calendar-events";
export {
  goalNodeId,
  habitNodeId,
  taskNodeId,
  goalToNode,
  habitToNode,
  taskToNode,
  timedEventToNode,
  bindTaskAssertionEdges,
} from "./adapters/scheduler";
export {
  pulseBlockNodeId,
  pulseBlocksToNodes,
} from "./adapters/pulse-blocks";
export {
  tiptapNodeId,
  editorToNode,
  type TipTapSnapshotInput,
} from "./adapters/tiptap";

export {
  defaultInvariants,
  defineInvariant,
  dailyDeepWorkFloor,
  noCalendarOverlap,
  maxDailyCommitmentHours,
  dependencyBufferRespected,
  goalDeadlineProtected,
  type DynamicInvariantDefinition,
} from "./invariants";

export {
  ForgeSyncCompiler,
  forkGraph,
  SEMANTIC_SIMILARITY_THRESHOLD,
  type ProposedDelta,
} from "./compiler";
export { TempoEngine } from "./tempo";

export {
  embedText,
  checkProseContradiction,
  clearEmbeddingCache,
  deterministicEmbedding,
  FALLBACK_EMBEDDING_DIM,
} from "./llm-proxy";

export {
  saveSnapshot,
  loadSnapshot,
  listProjectSnapshots,
  applyDeltaToSources,
  serialiseGraph,
  deserialiseGraph,
  type ApplyDeltaResult,
} from "./persistence";

export {
  AdvancedTempoEngine,
  type TempoOptions,
  type TempoRunReport,
  type MultiBookingFix,
  type CompactionMove,
} from "./tempo-advanced";

export {
  recordRun,
  getRun,
  listProjectRuns,
  type PersistedTempoRun,
} from "./tempo-runs";

export {
  INVARIANT_CATALOGUE,
  compileInvariant,
  compileAll,
  freshConfig,
  type InvariantConfig,
  type InvariantKind,
  type InvariantKindMeta,
} from "./invariant-dsl";

export {
  createInvariant,
  updateInvariant,
  deleteInvariant,
  listProjectInvariants,
  type PersistedInvariant,
} from "./invariant-store";
