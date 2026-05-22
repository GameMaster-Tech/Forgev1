/**
 * Graph builder — unifies the existing collection projections into a
 * single `Map<NodeId, ForgeGraphNode>` ready for the compiler.
 *
 * Sources accepted (every one is optional — the builder degrades cleanly
 * when a feature surface isn't loaded yet):
 *   • FirestoreDocument[]                (project documents)
 *   • Assertion[] + ConstraintEdge[]     (Sync graph contents)
 *   • CalendarEvent[]                    (calendar grid)
 *   • Goal[] / Habit[] / Task[]          (Tempo scheduler)
 *   • ContentBlock[]                     (Pulse blocks)
 *   • Live TipTap editor                 (semantic-reactivity hot path)
 *
 * Output is a single map keyed by graph NodeId. Hot-path callers (the
 * compiler) iterate this map directly.
 */

import type { CalendarEvent } from "@/lib/calendar/types";
import type { FirestoreDocument } from "@/lib/firebase/firestore";
import type { ContentBlock } from "@/lib/pulse/types";
import type { Assertion, ConstraintEdge } from "@/lib/sync/types";
import type { Goal, Habit, Task, TimedEvent } from "@/lib/scheduler/types";
import type { Editor } from "@tiptap/react";

import {
  type ForgeGraphNode,
  type NodeId,
} from "./types";
import { documentsToNodes } from "./adapters/documents";
import { assertionsToNodes } from "./adapters/assertions";
import { calendarEventsToNodes } from "./adapters/calendar-events";
import {
  bindTaskAssertionEdges,
  goalToNode,
  habitToNode,
  taskToNode,
  timedEventToNode,
} from "./adapters/scheduler";
import { pulseBlocksToNodes } from "./adapters/pulse-blocks";
import { editorToNode } from "./adapters/tiptap";

export interface BuildGraphInput {
  documents?: FirestoreDocument[];
  assertions?: Assertion[];
  constraints?: ConstraintEdge[];
  calendarEvents?: CalendarEvent[];
  goals?: Goal[];
  habits?: Habit[];
  tasks?: Task[];
  timedEvents?: TimedEvent[];
  pulseBlocks?: ContentBlock[];
  /** Optional live TipTap snapshot — replaces the matching document. */
  liveEditor?: {
    editor: Editor;
    documentId: string;
    projectId: string;
    title: string;
  };
}

/**
 * Assemble the graph map. Returns a *new* Map every call; do not mutate
 * it in place across renders.
 */
export function buildForgeGraph(input: BuildGraphInput): Map<NodeId, ForgeGraphNode> {
  const graph = new Map<NodeId, ForgeGraphNode>();

  if (input.documents && input.documents.length > 0) {
    const nodes = documentsToNodes(input.documents);
    for (let i = 0; i < nodes.length; i++) graph.set(nodes[i].id, nodes[i]);
  }

  if (input.assertions && input.assertions.length > 0) {
    const nodes = assertionsToNodes({
      assertions: input.assertions,
      constraints: input.constraints ?? [],
    });
    for (let i = 0; i < nodes.length; i++) graph.set(nodes[i].id, nodes[i]);
  }

  if (input.calendarEvents && input.calendarEvents.length > 0) {
    const nodes = calendarEventsToNodes(input.calendarEvents);
    for (let i = 0; i < nodes.length; i++) graph.set(nodes[i].id, nodes[i]);
  }

  if (input.timedEvents) {
    for (let i = 0; i < input.timedEvents.length; i++) {
      const n = timedEventToNode(input.timedEvents[i]);
      graph.set(n.id, n);
    }
  }

  if (input.goals) {
    for (let i = 0; i < input.goals.length; i++) {
      const n = goalToNode(input.goals[i]);
      graph.set(n.id, n);
    }
  }
  if (input.habits) {
    for (let i = 0; i < input.habits.length; i++) {
      const n = habitToNode(input.habits[i]);
      graph.set(n.id, n);
    }
  }
  if (input.tasks) {
    for (let i = 0; i < input.tasks.length; i++) {
      const n = taskToNode(input.tasks[i]);
      graph.set(n.id, n);
    }
  }

  if (input.pulseBlocks && input.pulseBlocks.length > 0) {
    const nodes = pulseBlocksToNodes(input.pulseBlocks);
    for (let i = 0; i < nodes.length; i++) graph.set(nodes[i].id, nodes[i]);
  }

  if (input.liveEditor) {
    const node = editorToNode({
      documentId: input.liveEditor.documentId,
      projectId: input.liveEditor.projectId,
      title: input.liveEditor.title,
      editor: input.liveEditor.editor,
    });
    graph.set(node.id, node);
  }

  // Resolve task → assertion key bindings once the assertion table is
  // present in the graph. Without this, the scheduler adapter would have
  // had to scan the world per-task — O(t·a) becomes O(t+a) here.
  if (input.tasks && input.assertions) {
    const keyToId = new Map<string, string>();
    for (let i = 0; i < input.assertions.length; i++) {
      keyToId.set(input.assertions[i].key, input.assertions[i].id);
    }
    const taskNodes: ForgeGraphNode[] = [];
    for (const node of graph.values()) {
      if (node.origin.collection === "scheduler_tasks") taskNodes.push(node);
    }
    bindTaskAssertionEdges(taskNodes, keyToId);
  }

  // Backfill downstream pointers. Every upstream edge implies its
  // downstream inverse; precomputing avoids a graph-wide scan in the
  // compiler's traversal loop later.
  for (const node of graph.values()) {
    const ups = node.upstreamDependencies;
    for (let i = 0; i < ups.length; i++) {
      const parent = graph.get(ups[i]);
      if (!parent) continue;
      if (parent.downstreamDependencies.indexOf(node.id) === -1) {
        parent.downstreamDependencies.push(node.id);
      }
    }
  }

  return graph;
}

/**
 * Topological iteration order. Used by the compiler when a delta needs
 * to be propagated downstream in dependency order without revisiting a
 * node. Returns an array of NodeId in topo order; isolated nodes appear
 * in insertion order. Cycles (which the spec forbids) are broken by
 * leaving the offending nodes at the end of the list.
 */
export function topoSort(graph: Map<NodeId, ForgeGraphNode>): NodeId[] {
  const indegree = new Map<NodeId, number>();
  for (const id of graph.keys()) indegree.set(id, 0);
  for (const node of graph.values()) {
    for (let i = 0; i < node.upstreamDependencies.length; i++) {
      const upId = node.upstreamDependencies[i];
      if (indegree.has(upId)) {
        indegree.set(node.id, (indegree.get(node.id) ?? 0) + 1);
      }
    }
  }

  const queue: NodeId[] = [];
  for (const [id, deg] of indegree) if (deg === 0) queue.push(id);

  const sorted: NodeId[] = [];
  // Index-pointer BFS — Array.shift() is O(n); the spec wants
  // sub-millisecond topo evaluation even with thousands of nodes.
  let head = 0;
  while (head < queue.length) {
    const id = queue[head++];
    sorted.push(id);
    const node = graph.get(id);
    if (!node) continue;
    for (let i = 0; i < node.downstreamDependencies.length; i++) {
      const downId = node.downstreamDependencies[i];
      const next = (indegree.get(downId) ?? 0) - 1;
      indegree.set(downId, next);
      if (next === 0) queue.push(downId);
    }
  }

  if (sorted.length < graph.size) {
    // Cycle — append remaining nodes in insertion order so callers still
    // see every id. Production code should treat this as a hard error.
    // Build an O(1) membership set so the fallback stays linear instead
    // of degenerating to O(n²) via `indexOf`.
    const seen = new Set(sorted);
    for (const id of graph.keys()) {
      if (!seen.has(id)) sorted.push(id);
    }
  }
  return sorted;
}
