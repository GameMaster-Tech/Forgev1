/**
 * Undo log — circular buffer of the last N applied LogicalPatches.
 *
 * Each entry captures the "before" assertion values so we can revert a
 * patch exactly, even after additional edits have been applied on top
 * of it. We snapshot the affected assertions (not the whole graph) so
 * the buffer stays small.
 *
 * Pure data structure — no I/O. The Sync page wraps this in React
 * state; cron-driven solvers can persist it to Firestore.
 */

import { DependencyGraph } from "./graph";
import type { Assertion, LogicalPatch } from "./types";

/** Maximum entries retained in the ring buffer. */
export const UNDO_BUFFER_SIZE = 10;

export interface UndoEntry {
  /** Patch id, mirrored from LogicalPatch.id. */
  id: string;
  /** Patch summary for the audit-trail UI. */
  summary: string;
  /** When the patch was applied (ms since epoch). */
  appliedAt: number;
  /** Number of assertions the patch changed. */
  changedCount: number;
  /**
   * Assertion snapshots captured immediately before the patch was
   * applied. Reverting copies these back into the graph in one shot.
   */
  beforeSnapshots: Assertion[];
}

/**
 * Append a new entry. Returns a fresh array — never mutates the input.
 * Trims to UNDO_BUFFER_SIZE preserving the most-recent entries.
 */
export function pushUndo(buffer: UndoEntry[], entry: UndoEntry): UndoEntry[] {
  const next = [...buffer, entry];
  if (next.length > UNDO_BUFFER_SIZE) {
    return next.slice(next.length - UNDO_BUFFER_SIZE);
  }
  return next;
}

/**
 * Capture an UndoEntry from a patch about to be applied. The caller is
 * expected to apply the patch and push this entry to the buffer.
 */
export function captureUndo(graph: DependencyGraph, patch: LogicalPatch, appliedAt = Date.now()): UndoEntry {
  const snapshots: Assertion[] = [];
  for (const c of patch.changes) {
    const a = graph.getAssertion(c.assertionId);
    if (a) snapshots.push({ ...a, value: { ...a.value } as Assertion["value"] });
  }
  return {
    id: patch.id,
    summary: patch.summary,
    appliedAt,
    changedCount: patch.changes.length,
    beforeSnapshots: snapshots,
  };
}

/**
 * Revert the most recent entry. Returns `{ buffer, restored }`:
 *   - buffer    — undo log with the popped entry removed
 *   - restored  — assertions written back; useful for telemetry/UI
 *
 * The graph is mutated in place via `upsertAssertion`. Confidence and
 * sourcedAt are restored exactly. If an assertion no longer exists
 * (e.g. user deleted it), the snapshot is skipped silently — there is
 * nothing to revert.
 */
export function revertLast(
  graph: DependencyGraph,
  buffer: UndoEntry[],
): { buffer: UndoEntry[]; restored: Assertion[] } {
  if (buffer.length === 0) return { buffer, restored: [] };
  const last = buffer[buffer.length - 1];
  const restored: Assertion[] = [];
  for (const snap of last.beforeSnapshots) {
    const cur = graph.getAssertion(snap.id);
    if (!cur) continue; // assertion deleted since the patch — skip silently
    graph.upsertAssertion(snap);
    restored.push(snap);
  }
  return { buffer: buffer.slice(0, -1), restored };
}

/** Total entries currently held. Useful for the UI. */
export function undoSize(buffer: UndoEntry[]): number {
  return buffer.length;
}

/** Format an entry's timestamp for audit-trail display. */
export function formatUndoTimestamp(t: number): string {
  return new Date(t).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}
