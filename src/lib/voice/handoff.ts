"use client";

/**
 * Aria handoff — a tiny client-side bridge for work that must finish on a
 * surface that mounts *after* navigation.
 *
 * When Aria creates a document she navigates to it immediately, but the editor
 * doesn't exist yet — so she can't type into it from the executor. Instead she
 * queues the content here; the doc page drains the queue once its live Tiptap
 * editor is ready and the Y.Doc has synced, then types it in. This keeps the
 * write on the collaborative layer (the Y.Doc is the source of truth) and gives
 * the visible "Aria is writing" effect, instead of pasting into Firestore's
 * `content` field and hoping the migration seed fires.
 *
 * Module-level state is fine: client navigation stays in one JS context.
 */

import type { Editor } from "@tiptap/react";

export type DocWriteMode = "append" | "prepend" | "replace";

interface PendingDocWrite {
  content: string;
  mode: DocWriteMode;
}

const pending = new Map<string, PendingDocWrite>();

/** Queue content for a document the doc page will type in once it mounts. */
export function queueDocWrite(docId: string, content: string, mode: DocWriteMode = "append"): void {
  pending.set(docId, { content, mode });
}

/** Claim (and clear) any queued write for a document. */
export function takeDocWrite(docId: string): PendingDocWrite | null {
  const w = pending.get(docId);
  if (w) pending.delete(docId);
  return w ?? null;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Visibly "type" text into a live Tiptap editor — collaborative/Y.Doc-safe,
 * word by word, paragraph by paragraph. Aborts cleanly if the editor unmounts
 * mid-stream (navigating away). Plain-text nodes are inserted (not parsed as
 * HTML), so stray angle brackets can't inject markup.
 */
export async function typeInto(editor: Editor, text: string, mode: DocWriteMode = "append"): Promise<void> {
  const clean = text.replace(/\r/g, "").trim();
  if (!clean || editor.isDestroyed) return;

  if (mode === "replace") editor.chain().focus().clearContent().run();
  const caret = mode === "prepend" ? 0 : editor.state.doc.content.size;
  editor.chain().focus().setTextSelection(caret).run();

  const paragraphs = clean.split(/\n{2,}/);
  for (let pi = 0; pi < paragraphs.length; pi++) {
    if (editor.isDestroyed) return;
    if (pi > 0) editor.chain().focus().splitBlock().run(); // start a new paragraph
    const tokens = paragraphs[pi].split(/(\s+)/).filter((t) => t.length > 0);
    for (const tok of tokens) {
      if (editor.isDestroyed) return;
      editor.chain().focus().insertContent({ type: "text", text: tok }).run();
      await wait(/^\s+$/.test(tok) ? 6 : 20); // a brief beat per word
    }
  }
}
