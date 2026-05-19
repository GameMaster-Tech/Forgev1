/**
 * Y.Doc factory — singleton per (kind, projectId, resourceId).
 *
 * Why a singleton: the editor binding, the cursor overlay, and the
 * presence strip all want the same Y.Doc. Two Y.Docs for the same
 * resource would mean two CRDT graphs that never reconcile.
 *
 * Memory bound: docs are dropped when the last subscriber unsubs.
 * Counted via `acquire` / `release`.
 */

import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { CollabDocId, CollabDocKind } from "./types";

interface Entry {
  doc: Y.Doc;
  awareness: Awareness;
  refs: number;
}

const REGISTRY = new Map<string, Entry>();

function keyOf(id: CollabDocId): string {
  return `${id.kind}::${id.projectId}::${id.resourceId}`;
}

export function acquireDoc(id: CollabDocId): { doc: Y.Doc; awareness: Awareness; release: () => void } {
  const key = keyOf(id);
  let entry = REGISTRY.get(key);
  if (!entry) {
    const doc = new Y.Doc({ guid: key });
    // Mark each Y.Doc with the resource it belongs to so persistence
    // adapters can pick the right Firestore path without re-deriving.
    doc.gc = true; // garbage-collect deleted ops
    const awareness = new Awareness(doc);
    entry = { doc, awareness, refs: 0 };
    REGISTRY.set(key, entry);
  }
  entry.refs += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const e = REGISTRY.get(key);
    if (!e) return;
    e.refs -= 1;
    if (e.refs <= 0) {
      e.awareness.destroy();
      e.doc.destroy();
      REGISTRY.delete(key);
    }
  };
  return { doc: entry.doc, awareness: entry.awareness, release };
}

/* ───────────── canonical Y types per kind ───────────── */

/**
 * Sharedness model per `CollabDocKind`:
 *   • editor       — Y.XmlFragment named "prosemirror" (TipTap convention)
 *   • lattice-tree — Y.Map of subtaskId → Y.Map of fields
 *   • sync-graph   — Y.Map of assertionId → Y.Map of fields
 *   • pulse-blocks — Y.Map of blockId → Y.Map of fields
 *
 * Callers reach into these via `editorFragment(doc)`, `subtasksMap(doc)`,
 * etc. so the binding code in this folder owns the shape.
 */

export function editorFragment(doc: Y.Doc): Y.XmlFragment {
  return doc.getXmlFragment("prosemirror");
}

export function subtasksMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap("subtasks");
}

export function assertionsMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap("assertions");
}

export function blocksMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap("blocks");
}

/** Diagnostic: how many docs the factory is holding. */
export function activeDocCount(): number {
  return REGISTRY.size;
}

/** Diagnostic — list current docs (kind + ref count). For DevTools. */
export function debugDocs(): Array<{ key: string; refs: number }> {
  return Array.from(REGISTRY.entries()).map(([key, e]) => ({ key, refs: e.refs }));
}

/** Map a docId to its associated CollabDocKind, used by adapter routing. */
export function kindOf(doc: Y.Doc): CollabDocKind | null {
  const guid = doc.guid;
  if (!guid) return null;
  const head = guid.split("::")[0];
  if (head === "editor" || head === "lattice-tree" || head === "sync-graph" || head === "pulse-blocks") {
    return head;
  }
  return null;
}
