/**
 * TipTap adapter — projects a live editor instance into the graph.
 *
 * The TipTap document is a tree; for the semantic-reactivity layer we
 * only need the plain text and a stable id. We synthesise a single
 * PROSE node per editor instance, scoped by the document id, so the
 * compiler can compare an in-flight edit against the rest of the
 * workspace without writing to Firestore first.
 *
 * Call sites:
 *   • `useSemanticReactivity` hook — passes the live editor on every
 *     debounced update.
 *   • `useForgeGraph` — re-projects the editor into the graph when the
 *     document changes shape (heading insert, etc.).
 */

import type { Editor } from "@tiptap/react";
import {
  ForgeNodeCategory,
  type ForgeGraphNode,
  type NodeId,
} from "../types";
import { documentNodeId } from "./documents";

export function tiptapNodeId(documentId: string): NodeId {
  // We reuse the document's graph id so a TipTap update *replaces* the
  // stored Firestore projection in the graph map — there is one PROSE
  // node per document and the editor is just the freshest snapshot.
  return documentNodeId(documentId);
}

export interface TipTapSnapshotInput {
  /** Firestore document id the editor is bound to. */
  documentId: string;
  /** Owning project. */
  projectId: string;
  /** Title from the document row (Tiptap doesn't own it). */
  title: string;
  /** The live editor instance. */
  editor: Editor;
}

export function editorToNode({
  documentId,
  projectId,
  title,
  editor,
}: TipTapSnapshotInput): ForgeGraphNode {
  // `state.doc.textContent` is the authoritative plain-text projection;
  // it skips marks and node types we don't care about for embedding.
  const text = editor.state.doc.textContent;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  return {
    id: tiptapNodeId(documentId),
    category: ForgeNodeCategory.PROSE,
    payload: {
      title,
      content: text,
      metadata: {
        wordCount,
        updatedAt: new Date(),
        // The TipTap snapshot is the freshest view of the doc; mark it
        // so persistence knows this projection beats the Firestore row
        // when both are present in the same graph build.
        live: true,
      },
    },
    upstreamDependencies: [],
    downstreamDependencies: [],
    status: "STABLE",
    version: Date.now(),
    origin: {
      collection: "tiptap_snapshot",
      externalId: documentId,
      projectId,
    },
  };
}
