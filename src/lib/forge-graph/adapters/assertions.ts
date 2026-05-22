/**
 * Assertion adapter — Sync `Assertion`s become DATA nodes.
 *
 * The dependency edges already encoded by the Sync `DependencyGraph`
 * (constraint edges) are projected onto the ForgeGraph as
 * up/downstream id arrays. This is the cheapest way to preserve the
 * existing logical wiring without duplicating constraints.
 */

import type { Assertion, ConstraintEdge } from "@/lib/sync/types";
import {
  ForgeNodeCategory,
  type ForgeGraphNode,
  type NodeId,
} from "../types";

export function assertionNodeId(assertionId: string): NodeId {
  return `assertion:${assertionId}`;
}

export interface AssertionAdapterInput {
  assertions: Assertion[];
  constraints: ConstraintEdge[];
}

export function assertionsToNodes({
  assertions,
  constraints,
}: AssertionAdapterInput): ForgeGraphNode[] {
  // Build upstream / downstream lookup tables in a single pass so the
  // per-node loop runs O(1). Map keyed by the *graph* node id so we can
  // hand the slice straight to the node assembly.
  const upstream = new Map<NodeId, NodeId[]>();
  const downstream = new Map<NodeId, NodeId[]>();

  for (let i = 0; i < constraints.length; i++) {
    const edge = constraints[i];
    const targetId = assertionNodeId(edge.to);
    const fromIds = Array.isArray(edge.from) ? edge.from : [edge.from];

    for (let j = 0; j < fromIds.length; j++) {
      const sourceId = assertionNodeId(fromIds[j]);
      pushInto(upstream, targetId, sourceId);
      pushInto(downstream, sourceId, targetId);
    }
  }

  const out: ForgeGraphNode[] = new Array(assertions.length);
  for (let i = 0; i < assertions.length; i++) {
    const a = assertions[i];
    const id = assertionNodeId(a.id);
    const valueText = stringifyValue(a.value);
    out[i] = {
      id,
      category: ForgeNodeCategory.DATA,
      payload: {
        title: a.label,
        content: `${a.label}: ${valueText}`,
        metadata: {
          assertionKey: a.key,
          kind: a.kind,
          value: a.value,
          unit: a.value.type === "number" ? a.value.unit : undefined,
          confidence: a.confidence,
          sourcedAt: new Date(a.sourcedAt),
          source: a.source,
          locked: a.locked === true,
        },
      },
      upstreamDependencies: upstream.get(id) ?? [],
      downstreamDependencies: downstream.get(id) ?? [],
      status: "STABLE",
      version: Math.floor(a.sourcedAt / 1000),
      origin: {
        collection: "assertions",
        externalId: a.id,
        projectId: a.projectId,
      },
    };
  }
  return out;
}

function pushInto(map: Map<NodeId, NodeId[]>, key: NodeId, value: NodeId): void {
  const arr = map.get(key);
  if (arr) {
    // Cheap dedupe; constraint sets are small per node.
    for (let i = 0; i < arr.length; i++) if (arr[i] === value) return;
    arr.push(value);
    return;
  }
  map.set(key, [value]);
}

function stringifyValue(v: Assertion["value"]): string {
  switch (v.type) {
    case "number":
      return v.unit ? `${v.value} ${v.unit}` : String(v.value);
    case "string":
      return v.value;
    case "date":
      return v.value;
    case "boolean":
      return v.value ? "true" : "false";
  }
}
