/**
 * Pulse-block adapter — `ContentBlock`s become PROSE nodes.
 *
 * Each ContentBlock references one or more assertions; we project those
 * references as upstream dependencies so the impact simulator can
 * cascade a value change into "blocks that need a rewrite."
 */

import type { ContentBlock } from "@/lib/pulse/types";
import {
  ForgeNodeCategory,
  type ForgeGraphNode,
  type NodeId,
} from "../types";
import { assertionNodeId } from "./assertions";
import { documentNodeId } from "./documents";

export function pulseBlockNodeId(blockId: string): NodeId {
  return `block:${blockId}`;
}

export function pulseBlocksToNodes(blocks: ContentBlock[]): ForgeGraphNode[] {
  const out: ForgeGraphNode[] = new Array(blocks.length);
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const upstream: NodeId[] = new Array(b.referencedAssertionIds.length);
    for (let j = 0; j < b.referencedAssertionIds.length; j++) {
      upstream[j] = assertionNodeId(b.referencedAssertionIds[j]);
    }
    out[i] = {
      id: pulseBlockNodeId(b.id),
      category: ForgeNodeCategory.PROSE,
      payload: {
        title: deriveBlockTitle(b.body),
        content: b.body,
        metadata: {
          documentId: b.documentId,
          referencedAssertionIds: b.referencedAssertionIds,
        },
      },
      upstreamDependencies: [documentNodeId(b.documentId), ...upstream],
      downstreamDependencies: [],
      status: "STABLE",
      version: 1,
      origin: {
        collection: "pulse_blocks",
        externalId: b.id,
        projectId: null,
      },
    };
  }
  return out;
}

function deriveBlockTitle(body: string): string {
  if (!body) return "Untitled block";
  const firstLine = body.split(/\r?\n/, 1)[0] ?? body;
  // Strip leading markdown markers (#, *, >) for a clean title.
  const cleaned = firstLine.replace(/^[#>*\-\s]+/, "").trim();
  return cleaned.length > 80 ? cleaned.slice(0, 77) + "…" : cleaned || "Untitled block";
}
