/**
 * Document adapter — wraps `FirestoreDocument` rows into PROSE nodes.
 *
 * Strict adapter: the underlying `documents` collection schema is *not*
 * mutated. A FirestoreDocument is read and projected into a
 * `ForgeGraphNode`; the projection carries the original id so the
 * persistence layer can map an applied delta back to the source row via
 * `forge-graph/persistence.ts`.
 */

import type { FirestoreDocument } from "@/lib/firebase/firestore";
import {
  ForgeNodeCategory,
  type ForgeGraphNode,
  type NodeId,
} from "../types";

/** Stable graph id for a Firestore document row. */
export function documentNodeId(docId: string): NodeId {
  return `doc:${docId}`;
}

export function documentToNode(doc: FirestoreDocument): ForgeGraphNode {
  const updated = millis(doc.updatedAt);
  return {
    id: documentNodeId(doc.id),
    category: ForgeNodeCategory.PROSE,
    payload: {
      title: doc.title,
      content: stripHtml(doc.content),
      metadata: {
        wordCount: doc.wordCount,
        citationCount: doc.citationCount,
        verifiedCount: doc.verifiedCount,
        updatedAt: updated ? new Date(updated) : undefined,
      },
    },
    upstreamDependencies: [],
    downstreamDependencies: [],
    status: "STABLE",
    version: deriveVersion(updated),
    origin: {
      collection: "documents",
      externalId: doc.id,
      projectId: doc.projectId,
    },
  };
}

export function documentsToNodes(docs: FirestoreDocument[]): ForgeGraphNode[] {
  const out: ForgeGraphNode[] = new Array(docs.length);
  for (let i = 0; i < docs.length; i++) out[i] = documentToNode(docs[i]);
  return out;
}

/* ───────────── helpers ───────────── */

interface MillisLike {
  toMillis?: () => number;
  seconds?: number;
  nanoseconds?: number;
}

function millis(ts: unknown): number | null {
  if (!ts) return null;
  const t = ts as MillisLike;
  if (typeof t.toMillis === "function") {
    try {
      return t.toMillis();
    } catch {
      return null;
    }
  }
  if (typeof t.seconds === "number") {
    return t.seconds * 1000 + Math.floor((t.nanoseconds ?? 0) / 1_000_000);
  }
  return null;
}

function deriveVersion(updatedMs: number | null): number {
  // Derive a monotonic version from the updatedAt epoch (seconds). This
  // lets Tempo bump the value safely without colliding with concurrent
  // writers that came in just after this snapshot was taken.
  if (!updatedMs) return 1;
  return Math.floor(updatedMs / 1000);
}

const HTML_TAG = /<[^>]+>/g;
const HTML_ENTITY = /&(amp|lt|gt|quot|#39);/g;
const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  "#39": "'",
};

/**
 * Cheap HTML-to-text projection. Documents are stored as Tiptap HTML —
 * the semantic-reactivity layer wants the readable prose, not the tags.
 * Kept on the hot path so the regex is precompiled at module load.
 */
function stripHtml(html: string): string {
  if (!html) return "";
  return html
    .replace(HTML_TAG, " ")
    .replace(HTML_ENTITY, (_, name) => ENTITY_MAP[name] ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
