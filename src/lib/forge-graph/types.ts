/**
 * Forge Reactive Workspace — core graph schema (V6.5 spec §3.1).
 *
 * Single source of truth for the deterministic DAG that the Impact
 * Simulator, the Operational Invariant Asserter, the Tempo Engine, and
 * the Semantic Reactivity layer all operate on.
 *
 * Design constraints (from the master spec):
 *   • V8 HOT-PATH: every shape on a traversal hot path is a flat object
 *     or a `Map`; embeddings are `Float32Array`, dependency edges are
 *     `string[]`. No nested deep-clone targets except `payload.metadata`.
 *   • ZERO-PLACEHOLDER: every field a compiler/tempo/invariant path
 *     reaches is fully described here.
 *   • ADAPTER ONLY: this module never writes to Firestore. Existing
 *     production collections (documents, projects, calendar events,
 *     assertions, goals, habits, tasks) are wrapped into `ForgeGraphNode`s
 *     by the per-source adapters in `./adapters`.
 */

export type NodeId = string;

/**
 * Five node categories that the graph traverses. `TASK` is present
 * because the spec compiler hot path branches on it; the Tempo engine
 * shifts both `CALENDAR_EVENT` and `TASK` nodes on a propagated date
 * delta.
 */
export enum ForgeNodeCategory {
  DATA = "DATA",
  GOAL = "GOAL",
  CALENDAR_EVENT = "CALENDAR_EVENT",
  TASK = "TASK",
  PROSE = "PROSE",
}

/**
 * Stable identifier of an upstream record in its native Firestore
 * collection. Adapters write this so the persistence layer can map a
 * graph node back to the row that produced it without storing whole
 * documents inside the graph itself.
 */
export interface ForgeNodeOrigin {
  /**
   * The original collection the row lives in. Used by
   * `forge-graph/persistence.ts` to dispatch writes.
   */
  collection:
    | "documents"
    | "calendar_events"
    | "assertions"
    | "pulse_blocks"
    | "scheduler_goals"
    | "scheduler_habits"
    | "scheduler_tasks"
    | "tiptap_snapshot";
  /** Native id of the row. Composite-key sources flatten it here. */
  externalId: string;
  /** Project the row belongs to, when one is known. */
  projectId: string | null;
}

/**
 * Metadata fields are *open*. The adapters fill in the canonical set
 * (start/end date, duration, allocated capacity), and feature-specific
 * adapters may add their own scalar fields (e.g. `wordCount` on PROSE).
 * The compiler only reads canonical fields directly.
 */
export interface ForgeNodeMetadata {
  startDate?: Date;
  endDate?: Date;
  durationHours?: number;
  /** 0-100; consumed by the deep-work / capacity invariants. */
  allocatedCapacity?: number;
  /** Free scalars — adapters may attach source-specific data here. */
  [key: string]: unknown;
}

export interface ForgeNodePayload {
  title: string;
  content: string;
  metadata: ForgeNodeMetadata;
}

export type ForgeNodeStatus = "STABLE" | "CONFLICTED" | "DRIFTING";

export interface ForgeGraphNode {
  id: NodeId;
  category: ForgeNodeCategory;
  payload: ForgeNodePayload;
  /**
   * Lazily populated by the semantic-reactivity proxy. Stored as a
   * Float32Array so dot-product math is contiguous and cache-friendly.
   * `undefined` until the first embed call resolves.
   */
  semanticEmbedding?: Float32Array;
  /** Ids of nodes this node depends on (cardinality is low). */
  upstreamDependencies: NodeId[];
  /** Ids of nodes that depend on this one. */
  downstreamDependencies: NodeId[];
  status: ForgeNodeStatus;
  /** Monotonic. Bumped by Tempo on every applied mutation. */
  version: number;
  /** Pointer back to the source row that produced this node. */
  origin: ForgeNodeOrigin;
}

/* ───────────────────── Invariant framework ───────────────────── */

export interface InvariantEvaluation {
  passed: boolean;
  /** Human-readable description shown in the UI when `passed === false`. */
  errorDetail?: string;
  /** Optional ids of nodes that contributed to the failure. */
  offendingNodeIds?: NodeId[];
}

export interface WorkspaceInvariant {
  id: string;
  description: string;
  /**
   * Pure predicate over the *sandbox* graph. Must not mutate. Must run
   * in O(graph) at worst and complete inside the hot-path budget; see
   * `compiler.generateImpactReport`.
   */
  evaluator: (graph: Map<NodeId, ForgeGraphNode>) => InvariantEvaluation;
  /**
   * When `true`, a failed predicate blocks the sandbox merge entirely
   * (`isViable=false`). When `false`, the failure is recorded and the
   * delta's `globalRiskScore` is bumped but the merge can still proceed
   * if the user explicitly overrides. Defaults to `true`.
   */
  blocking?: boolean;
}

/* ───────────────────── Delta map (sandbox output) ───────────────────── */

export interface DeltaMutation {
  nodeId: NodeId;
  /** Dotted path inside `payload` ("metadata.startDate", "title", …). */
  targetField: string;
  previousValue: unknown;
  proposedValue: unknown;
  /** Human-readable magnitude ("+3 days shift", "‐12% capacity"). */
  deltaMagnitude: string;
}

export interface AssertionFailure {
  invariantId: string;
  description: string;
  suggestedFix: string;
  offendingNodeIds: NodeId[];
}

export interface VisualDeltaMap {
  scenarioPrompt: string;
  isViable: boolean;
  /** 0-100. 100 means the simulation must be rejected. */
  globalRiskScore: number;
  mutations: DeltaMutation[];
  assertionFailures: AssertionFailure[];
  /** ISO timestamp the simulator captured the sandbox at. */
  simulatedAt: string;
}

/* ───────────────────── Semantic reactivity ───────────────────── */

export interface SemanticConflict {
  targetNodeId: NodeId;
  /** Free-form explanation from the LLM judgement layer. */
  reason: string;
  /** Cosine similarity (0..1) that triggered the deeper LLM check. */
  similarity: number;
}

/**
 * Pluggable embedding adapter. The default implementation lives in
 * `forge-graph/llm-proxy.ts` and routes through `/api/forge-graph/embed`,
 * which fronts Voyage AI when a key is available and falls back to a
 * deterministic locality-sensitive hash otherwise.
 */
export type EmbeddingProxy = (text: string) => Promise<Float32Array>;

/**
 * LLM judgement adapter. Returns `{ conflict: true }` when prose A
 * contradicts prose B (not merely overlaps or paraphrases).
 */
export type LlmValidationProxy = (
  proseA: string,
  proseB: string,
) => Promise<{ conflict: boolean; reason?: string }>;

/* ───────────────────── Persistence snapshot ───────────────────── */

export interface ForgeGraphSnapshot {
  id: string;
  projectId: string;
  /** Compact JSON of the graph; rehydrated by `persistence.loadSnapshot`. */
  payload: SerialisedGraph;
  createdAt: number;
  scenario: string;
  /** Free-form notes; the UI surfaces them on the Compiler timeline. */
  notes?: string;
}

export interface SerialisedNode {
  id: NodeId;
  category: ForgeNodeCategory;
  payload: {
    title: string;
    content: string;
    metadata: Record<string, unknown>;
  };
  upstreamDependencies: NodeId[];
  downstreamDependencies: NodeId[];
  status: ForgeNodeStatus;
  version: number;
  origin: ForgeNodeOrigin;
  /** Base64-encoded Float32Array payload, when an embedding was computed. */
  semanticEmbeddingB64?: string;
}

export interface SerialisedGraph {
  nodes: SerialisedNode[];
  /** Schema version of the serialised payload; rev when shape changes. */
  rev: number;
}
