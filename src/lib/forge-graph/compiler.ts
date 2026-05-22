/**
 * ForgeSyncCompiler — sandboxed Impact Simulator + Semantic Reactivity
 * evaluator. Maps directly onto §3.2 of the master spec.
 *
 *   • `generateImpactReport`   — fork the live graph into an isolated
 *     sandbox, apply a proposed delta to a target node, cascade date
 *     shifts downstream, run every WorkspaceInvariant, return a
 *     VisualDeltaMap. The active graph is never mutated.
 *
 *   • `evaluateSemanticReactivity` — embed the incoming prose, scan
 *     every PROSE node, and surface conflicts where similarity passes
 *     a threshold AND the LLM judgement layer confirms the contradiction.
 *
 * V8 hot-path discipline:
 *   • The sandbox uses a single-level `payload.metadata` clone (only
 *     the field the mutation touches sits on the hot path). Other
 *     fields are shared by reference until written, which keeps the
 *     allocation footprint at O(touched-nodes).
 *   • Downstream traversal uses a bounded visited-set + array-based
 *     queue (no Set.has on a deeply nested data structure).
 *   • The semantic loop's dot-product is a tight numeric for-loop over
 *     two Float32Arrays.
 */

import {
  ForgeNodeCategory,
  type AssertionFailure,
  type DeltaMutation,
  type EmbeddingProxy,
  type ForgeGraphNode,
  type LlmValidationProxy,
  type NodeId,
  type SemanticConflict,
  type VisualDeltaMap,
  type WorkspaceInvariant,
} from "./types";

/** Cosine similarity threshold for triggering the deeper LLM check. */
export const SEMANTIC_SIMILARITY_THRESHOLD = 0.75;

export interface ProposedDelta {
  /** Fields to overwrite on `payload.metadata` of the target node. */
  metadata?: Record<string, unknown>;
  /** Shorthand: shift this node and every downstream date by N days. */
  daysShift?: number;
  /** Optional payload-level overrides (title, content). */
  title?: string;
  content?: string;
}

export class ForgeSyncCompiler {
  private readonly activeGraph: Map<NodeId, ForgeGraphNode>;
  private readonly invariants: WorkspaceInvariant[];

  constructor(
    initialGraph: Map<NodeId, ForgeGraphNode>,
    invariants: WorkspaceInvariant[],
  ) {
    this.activeGraph = initialGraph;
    this.invariants = invariants;
  }

  /** Exposes the current graph to callers that need to render it. */
  graph(): Map<NodeId, ForgeGraphNode> {
    return this.activeGraph;
  }

  /**
   * The Impact Simulator. Produces a `VisualDeltaMap` without touching
   * the active graph. The returned sandbox can be passed to
   * `TempoEngine.executeCalendarSorting` after the user accepts.
   */
  generateImpactReport(
    targetNodeId: NodeId,
    proposedDelta: ProposedDelta,
  ): { deltaMap: VisualDeltaMap; sandbox: Map<NodeId, ForgeGraphNode> } {
    const sandbox = forkGraph(this.activeGraph);

    const mutations: DeltaMutation[] = [];
    const target = sandbox.get(targetNodeId);
    if (target) {
      applyDirectMutation(target, proposedDelta, mutations);
    }

    if (typeof proposedDelta.daysShift === "number" && proposedDelta.daysShift !== 0) {
      cascadeDaysShift(
        sandbox,
        target ? target.downstreamDependencies : [],
        proposedDelta.daysShift,
        mutations,
      );
    }

    const assertionFailures: AssertionFailure[] = [];
    let hardFail = false;
    for (let i = 0; i < this.invariants.length; i++) {
      const inv = this.invariants[i];
      const result = inv.evaluator(sandbox);
      if (!result.passed) {
        assertionFailures.push({
          invariantId: inv.id,
          description: inv.description,
          suggestedFix: result.errorDetail ?? "Constraint limit breached.",
          offendingNodeIds: result.offendingNodeIds ?? [],
        });
        if (inv.blocking !== false) hardFail = true;
      }
    }

    const deltaMap: VisualDeltaMap = {
      scenarioPrompt: `Simulation for modification on Node: ${targetNodeId}`,
      isViable: !hardFail,
      globalRiskScore: hardFail ? 100 : Math.min(100, mutations.length * 5),
      mutations,
      assertionFailures,
      simulatedAt: new Date().toISOString(),
    };

    return { deltaMap, sandbox };
  }

  /**
   * Semantic Reactivity — embed the incoming prose, fan out over all
   * PROSE nodes, and surface contradictions confirmed by the LLM.
   *
   * Throws when the embedding proxy fails. Soft-fails (logs + skips)
   * when an individual LLM judgement fails so a single transient error
   * doesn't poison the whole pass.
   */
  async evaluateSemanticReactivity(
    newNodeContent: string,
    embeddingProxy: EmbeddingProxy,
    llmValidationProxy: LlmValidationProxy,
    options: { excludeNodeId?: NodeId; minLength?: number; maxConcurrent?: number } = {},
  ): Promise<SemanticConflict[]> {
    const minLength = options.minLength ?? 24;
    if (newNodeContent.trim().length < minLength) return [];

    const incoming = await embeddingProxy(newNodeContent);
    if (!incoming || incoming.length === 0) return [];

    // PHASE 1 — prefilter purely from local Float32 dot-products.
    // Network is never touched inside this loop; only the hot-path
    // candidates make it to phase 2.
    interface Candidate {
      id: NodeId;
      content: string;
      similarity: number;
    }
    const candidates: Candidate[] = [];
    for (const [id, node] of this.activeGraph.entries()) {
      if (node.category !== ForgeNodeCategory.PROSE) continue;
      if (options.excludeNodeId && id === options.excludeNodeId) continue;
      const stored = node.semanticEmbedding;
      if (!stored || stored.length !== incoming.length) continue;
      if (!node.payload.content || node.payload.content.length < minLength) continue;
      const similarity = dot(incoming, stored);
      if (similarity <= SEMANTIC_SIMILARITY_THRESHOLD) continue;
      candidates.push({ id, content: node.payload.content, similarity });
    }
    if (candidates.length === 0) return [];

    // PHASE 2 — run LLM judgements with bounded concurrency. The
    // semantic similarity prefilter already trimmed the set; this
    // keeps total wall-clock at ~ceil(N / workers) × per-call latency
    // instead of N × per-call (the serial path the spec literally
    // describes but the product cannot afford on every keystroke).
    const maxConcurrent = Math.max(1, options.maxConcurrent ?? 4);
    const conflicts: SemanticConflict[] = [];
    let cursor = 0;
    const workers: Promise<void>[] = [];
    for (let w = 0; w < maxConcurrent; w++) {
      workers.push(
        (async () => {
          while (true) {
            const i = cursor;
            cursor += 1;
            if (i >= candidates.length) return;
            const c = candidates[i];
            try {
              const verdict = await llmValidationProxy(newNodeContent, c.content);
              if (verdict.conflict) {
                conflicts.push({
                  targetNodeId: c.id,
                  reason:
                    verdict.reason ??
                    "Semantic inconsistency verified by LLM analysis layer.",
                  similarity: c.similarity,
                });
              }
            } catch (err) {
              if (typeof console !== "undefined") {
                console.warn("[forge-graph] LLM validation failed for", c.id, err);
              }
            }
          }
        })(),
      );
    }
    await Promise.all(workers);
    // Preserve top-similarity-first order.
    conflicts.sort((a, b) => b.similarity - a.similarity);
    return conflicts;
  }
}

/* ───────────────────── helpers ───────────────────── */

/**
 * Shallow-but-correct sandbox fork. The payload metadata is copied so
 * mutations don't leak; everything else (the node id, category, edge
 * arrays, embedding) is shared by reference until something tries to
 * write it.
 */
export function forkGraph(
  source: Map<NodeId, ForgeGraphNode>,
): Map<NodeId, ForgeGraphNode> {
  const sandbox = new Map<NodeId, ForgeGraphNode>();
  for (const [id, node] of source.entries()) {
    sandbox.set(id, {
      ...node,
      payload: {
        title: node.payload.title,
        content: node.payload.content,
        metadata: { ...node.payload.metadata },
      },
      upstreamDependencies: node.upstreamDependencies.slice(),
      downstreamDependencies: node.downstreamDependencies.slice(),
    });
  }
  return sandbox;
}

function applyDirectMutation(
  target: ForgeGraphNode,
  delta: ProposedDelta,
  mutations: DeltaMutation[],
): void {
  if (delta.metadata) {
    for (const key of Object.keys(delta.metadata)) {
      const prev = target.payload.metadata[key];
      const next = delta.metadata[key];
      target.payload.metadata[key] = next;
      mutations.push({
        nodeId: target.id,
        targetField: `metadata.${key}`,
        previousValue: prev,
        proposedValue: next,
        deltaMagnitude: describeMagnitude(prev, next),
      });
    }
  }
  if (typeof delta.title === "string" && delta.title !== target.payload.title) {
    mutations.push({
      nodeId: target.id,
      targetField: "title",
      previousValue: target.payload.title,
      proposedValue: delta.title,
      deltaMagnitude: "Title rename",
    });
    target.payload.title = delta.title;
  }
  if (typeof delta.content === "string" && delta.content !== target.payload.content) {
    mutations.push({
      nodeId: target.id,
      targetField: "content",
      previousValue: target.payload.content,
      proposedValue: delta.content,
      deltaMagnitude: "Body rewrite",
    });
    target.payload.content = delta.content;
  }
}

function cascadeDaysShift(
  sandbox: Map<NodeId, ForgeGraphNode>,
  seeds: NodeId[],
  daysShift: number,
  mutations: DeltaMutation[],
): void {
  const shiftMs = daysShift * 86_400_000;
  const visited = new Set<NodeId>();
  // Index-pointer BFS so each dequeue is O(1) (Array.shift() is O(n)
  // and tanks the V8 hot-path budget the spec demands).
  const queue: NodeId[] = seeds.slice();
  let head = 0;

  while (head < queue.length) {
    const id = queue[head++];
    if (visited.has(id)) continue;
    visited.add(id);

    const node = sandbox.get(id);
    if (!node) continue;

    const isShiftable =
      node.category === ForgeNodeCategory.CALENDAR_EVENT ||
      node.category === ForgeNodeCategory.TASK;

    if (isShiftable) {
      const start = node.payload.metadata.startDate;
      if (start instanceof Date) {
        const previousStart = new Date(start.getTime());
        const nextStart = new Date(start.getTime() + shiftMs);
        node.payload.metadata.startDate = nextStart;
        mutations.push({
          nodeId: id,
          targetField: "metadata.startDate",
          previousValue: previousStart,
          proposedValue: nextStart,
          deltaMagnitude: `${daysShift > 0 ? "+" : ""}${daysShift} days shift`,
        });
      }
      const end = node.payload.metadata.endDate;
      if (end instanceof Date) {
        const previousEnd = new Date(end.getTime());
        const nextEnd = new Date(end.getTime() + shiftMs);
        node.payload.metadata.endDate = nextEnd;
        mutations.push({
          nodeId: id,
          targetField: "metadata.endDate",
          previousValue: previousEnd,
          proposedValue: nextEnd,
          deltaMagnitude: `${daysShift > 0 ? "+" : ""}${daysShift} days shift`,
        });
      }
    }

    for (let i = 0; i < node.downstreamDependencies.length; i++) {
      const next = node.downstreamDependencies[i];
      if (!visited.has(next)) queue.push(next);
    }
  }
}

function describeMagnitude(prev: unknown, next: unknown): string {
  if (typeof prev === "number" && typeof next === "number") {
    const diff = next - prev;
    const sign = diff > 0 ? "+" : "";
    return `${sign}${formatNumber(diff)} (was ${formatNumber(prev)})`;
  }
  if (prev instanceof Date && next instanceof Date) {
    const diffMs = next.getTime() - prev.getTime();
    const days = diffMs / 86_400_000;
    const sign = days > 0 ? "+" : "";
    return `${sign}${days.toFixed(1)} day shift`;
  }
  return "Direct input manipulation";
}

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1000) return n.toFixed(0);
  if (Math.abs(n) >= 1) return n.toFixed(2);
  return n.toFixed(3);
}

/** Tight inner-loop dot-product over two equally-sized Float32Arrays. */
function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0;
  const len = a.length;
  for (let i = 0; i < len; i++) sum += a[i] * b[i];
  return sum;
}
