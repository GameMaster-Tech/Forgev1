/**
 * TempoEngine — autonomous calendar sorting (spec §3.3).
 *
 * Once a sandbox `VisualDeltaMap` is accepted, the Tempo engine
 * deterministically applies each mutation to a fresh copy of the live
 * graph, then resolves overlapping calendar events by sliding the later
 * event forward until the conflict clears. Returns the resorted graph
 * for the persistence layer to write back.
 */

import {
  ForgeNodeCategory,
  type ForgeGraphNode,
  type NodeId,
  type VisualDeltaMap,
} from "./types";

export class TempoEngine {
  executeCalendarSorting(
    graph: Map<NodeId, ForgeGraphNode>,
    approvedDelta: VisualDeltaMap,
  ): Map<NodeId, ForgeGraphNode> {
    if (!approvedDelta.isViable) {
      throw new Error(
        `TempoEngine refuses to apply a non-viable delta (${approvedDelta.assertionFailures.length} blocking invariants failed).`,
      );
    }

    // Shallow-fork the graph just like the compiler does. Tempo writes
    // into the fork; callers persist the fork.
    const sorted = new Map<NodeId, ForgeGraphNode>();
    for (const [id, node] of graph.entries()) {
      sorted.set(id, {
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

    // Apply each mutation. Numbers and dates are the two routine
    // targets; the simulator emits both forms so we handle them both.
    for (let i = 0; i < approvedDelta.mutations.length; i++) {
      const m = approvedDelta.mutations[i];
      const node = sorted.get(m.nodeId);
      if (!node) continue;
      if (m.targetField === "title") {
        node.payload.title = String(m.proposedValue);
      } else if (m.targetField === "content") {
        node.payload.content = String(m.proposedValue);
      } else if (m.targetField.startsWith("metadata.")) {
        const key = m.targetField.slice("metadata.".length);
        // Re-construct Date objects from serialised JSON when needed.
        if (key === "startDate" || key === "endDate") {
          node.payload.metadata[key] =
            m.proposedValue instanceof Date
              ? m.proposedValue
              : new Date(m.proposedValue as string | number);
        } else {
          node.payload.metadata[key] = m.proposedValue;
        }
      }
      node.version += 1;
      node.status = "STABLE";
    }

    // Resolve overlapping calendar events by sliding each subsequent
    // event past the previous event's end. This compacts the timeline
    // while keeping all events visible.
    resolveOverlaps(sorted);

    return sorted;
  }
}

function resolveOverlaps(graph: Map<NodeId, ForgeGraphNode>): void {
  const events: ForgeGraphNode[] = [];
  for (const node of graph.values()) {
    if (node.category !== ForgeNodeCategory.CALENDAR_EVENT) continue;
    const start = node.payload.metadata.startDate;
    if (!(start instanceof Date)) continue;
    // Filter out pinned events; they refuse to move.
    if (node.payload.metadata.pinned === true) continue;
    events.push(node);
  }
  events.sort((a, b) => {
    const sa = a.payload.metadata.startDate as Date;
    const sb = b.payload.metadata.startDate as Date;
    return sa.getTime() - sb.getTime();
  });

  for (let i = 0; i + 1 < events.length; i++) {
    const current = events[i];
    const next = events[i + 1];
    const currentEnd = endOf(current);
    const nextStart = next.payload.metadata.startDate as Date;
    if (currentEnd.getTime() <= nextStart.getTime()) continue;

    const overlapMs = currentEnd.getTime() - nextStart.getTime();
    const newStart = new Date(nextStart.getTime() + overlapMs);
    next.payload.metadata.startDate = newStart;
    const nextEnd = next.payload.metadata.endDate;
    if (nextEnd instanceof Date) {
      next.payload.metadata.endDate = new Date(nextEnd.getTime() + overlapMs);
    }
    next.version += 1;
    next.status = "STABLE";
  }
}

function endOf(node: ForgeGraphNode): Date {
  const end = node.payload.metadata.endDate;
  if (end instanceof Date) return end;
  const start = node.payload.metadata.startDate as Date;
  const durationHours = node.payload.metadata.durationHours;
  const durationMs = typeof durationHours === "number" ? durationHours * 3_600_000 : 3_600_000;
  return new Date(start.getTime() + durationMs);
}
