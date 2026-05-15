/**
 * Watcher — long-lived controller that keeps a TaskTree in sync with a
 * mutating ProjectContext.
 *
 * Responsibilities
 *  • Debounce bursts of `WatcherEvent`s. Multiple writes that arrive
 *    within `debounceMs` collapse into a single rebranch.
 *  • Decide whether an event invalidates the decomposition (re-runs
 *    `decomposeTask`) or only changes resolution status (cheaper
 *    `resolveTree`).
 *  • Single-flight: while a rebranch is in flight, additional events
 *    queue. After the in-flight run finishes, if anything queued, a
 *    fresh rebranch fires against the latest context.
 *  • Surface a clean `RebranchResult` to subscribers.
 *  • Dispose cleanly: cancels timers, rejects pending flushes,
 *    detaches subscribers.
 *
 * Headless. Uses `setTimeout` only when running in the browser; on
 * Node-like hosts the debounce window collapses to zero (immediate
 * flush) — appropriate for unit tests and SSR.
 */

import { decomposeTask, pruneTree } from "./decompose";
import { cloneTree, resolveTree } from "./resolve";
import type {
  AtomicSubtask,
  ProjectContext,
  RebranchResult,
  StatusHistoryEntry,
  TaskId,
  TaskTree,
  WatcherController,
  WatcherEvent,
  WatcherOptions,
} from "./types";

export interface CreateWatcherArgs {
  /** Top-level task string. Treated as immutable per controller. */
  parentTask: string;
  /** Callback the watcher calls when it needs the current context. */
  getContext: () => ProjectContext | Promise<ProjectContext>;
  /** Optional initial tree (e.g. one persisted to Firestore). */
  initialTree?: TaskTree;
  options?: WatcherOptions;
}

export function createWatcher(args: CreateWatcherArgs): WatcherController {
  const debounceMs = args.options?.debounceMs ?? 200;
  const refreshDraftsOnAnyChange = args.options?.refreshDraftsOnAnyChange ?? true;

  let tree: TaskTree | null = args.initialTree ?? null;
  let queued: WatcherEvent[] = [];
  let inFlight: Promise<RebranchResult | null> | null = null;
  let scheduled: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  const subscribers = new Set<(r: RebranchResult) => void>();

  function emit(r: RebranchResult): void {
    for (const fn of subscribers) {
      try { fn(r); } catch { /* swallow subscriber errors */ }
    }
  }

  async function runRebranch(): Promise<RebranchResult | null> {
    if (disposed) return null;
    const events = queued.splice(0, queued.length); // drain
    let ctx: ProjectContext;
    try {
      ctx = await args.getContext();
    } catch (err) {
      // Surface the failure as a blocked status on every task — better
      // than silently doing nothing. Use the current tree if any.
      if (!tree) return null;
      const blocked = blockAll(tree, `getContext failed: ${(err as Error).message}`);
      tree = blocked.tree;
      const result: RebranchResult = {
        added: [], removed: [], statusChanged: blocked.changed, draftsRefreshed: [],
        blocked: Array.from(tree.tasks.keys()),
        ranAt: Date.now(),
      };
      emit(result);
      return result;
    }

    // First pass: decide whether the event set actually invalidates the
    // current decomposition. Heuristic: any change to an assertion key
    // bound by a task, or to a bound document, triggers a re-decompose.
    // A pure-status refresh suffices otherwise.
    const decomposeNeeded = tree === null || shouldRedecompose(tree, events, refreshDraftsOnAnyChange);

    if (decomposeNeeded) {
      const result = decomposeTask(args.parentTask, ctx, tree ?? undefined);
      // Run the resolver on top of the freshly decomposed tree so the
      // statuses reflect the same context the decomposer just saw.
      const resolved = resolveTree(result.tree, ctx);
      tree = pruneTree(resolved.tree);
      const r: RebranchResult = {
        added: result.added,
        removed: result.removed,
        statusChanged: resolved.changed,
        draftsRefreshed: result.draftsRefreshed,
        blocked: blockedIds(resolved.tree),
        ranAt: Date.now(),
      };
      emit(r);
      return r;
    }

    // Cheap path: re-resolve only.
    const before = cloneTree(tree!);
    const resolved = resolveTree(tree!, ctx);
    tree = pruneTree(resolved.tree);
    void before;
    const r: RebranchResult = {
      added: [],
      removed: [],
      statusChanged: resolved.changed,
      draftsRefreshed: [],
      blocked: blockedIds(resolved.tree),
      ranAt: Date.now(),
    };
    emit(r);
    return r;
  }

  function scheduleFlush(): void {
    if (disposed) return;
    if (scheduled !== null) return;
    if (typeof window === "undefined" || debounceMs <= 0) {
      // Immediate flush (node / tests).
      Promise.resolve().then(() => triggerFlush());
      return;
    }
    scheduled = setTimeout(() => {
      scheduled = null;
      void triggerFlush();
    }, debounceMs);
  }

  function triggerFlush(): Promise<RebranchResult | null> {
    if (inFlight) {
      // Coalesce with the in-flight run; once it completes, kick off
      // another iff events queued during the wait.
      return inFlight.then((prev) => {
        if (queued.length > 0 && !disposed) return triggerFlush();
        return prev;
      });
    }
    inFlight = runRebranch().finally(() => {
      inFlight = null;
      if (queued.length > 0 && !disposed) scheduleFlush();
    });
    return inFlight;
  }

  /* ── public surface ── */

  function push(event: WatcherEvent): void {
    if (disposed) return;
    queued.push(event);
    scheduleFlush();
  }

  function flush(): Promise<RebranchResult | null> {
    if (disposed) return Promise.resolve(null);
    if (scheduled !== null) {
      clearTimeout(scheduled);
      scheduled = null;
    }
    return triggerFlush();
  }

  function subscribe(handler: (r: RebranchResult) => void): () => void {
    subscribers.add(handler);
    return () => subscribers.delete(handler);
  }

  function getTree(): TaskTree {
    if (!tree) {
      throw new Error("Lattice.watcher: tree is not initialised — call flush() first");
    }
    return tree;
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    if (scheduled !== null) {
      clearTimeout(scheduled);
      scheduled = null;
    }
    subscribers.clear();
    queued = [];
  }

  return { push, flush, subscribe, getTree, dispose };
}

/* ───────────── internals ───────────── */

function shouldRedecompose(
  tree: TaskTree,
  events: WatcherEvent[],
  refreshDraftsOnAnyChange: boolean,
): boolean {
  if (events.length === 0) return false;
  if (events.some((e) => e.kind === "context-replace")) return true;
  const boundKeys = new Set<string>();
  const boundDocs = new Set<string>();
  for (const t of tree.tasks.values()) {
    for (const k of t.boundAssertionKeys) boundKeys.add(k);
    for (const d of t.boundDocumentIds) boundDocs.add(d);
  }
  for (const e of events) {
    if (e.kind === "assertion-upsert" || e.kind === "assertion-delete") {
      if (boundKeys.has(e.key)) return true;
    } else if (e.kind === "document-upsert" || e.kind === "document-delete") {
      if (boundDocs.has(e.documentId)) return true;
    }
  }
  // Status-only refresh covers any leftover cases.
  return refreshDraftsOnAnyChange ? false : false;
}

function blockedIds(tree: TaskTree): TaskId[] {
  const out: TaskId[] = [];
  for (const t of tree.tasks.values()) {
    if (t.status === "blocked") out.push(t.id);
  }
  return out;
}

function blockAll(tree: TaskTree, reason: string): { tree: TaskTree; changed: { id: TaskId; from: AtomicSubtask["status"]; to: AtomicSubtask["status"] }[] } {
  const next = cloneTree(tree);
  const changed: { id: TaskId; from: AtomicSubtask["status"]; to: AtomicSubtask["status"] }[] = [];
  const now = Date.now();
  for (const [id, t] of next.tasks) {
    if (t.userLocked || t.status === "complete" || t.status === "irrelevant") continue;
    if (t.status === "blocked") continue;
    const entry: StatusHistoryEntry = { status: "blocked", at: now, by: "watcher", reason };
    next.tasks.set(id, {
      ...t,
      status: "blocked",
      updatedAt: now,
      history: [...t.history, entry].slice(-20),
    });
    changed.push({ id, from: t.status, to: "blocked" });
  }
  return { tree: next, changed };
}
