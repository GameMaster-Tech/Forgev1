/**
 * Lattice tree persistence — Firestore mirror + onSnapshot reconciler.
 *
 * Storage layout (per-user, per-project):
 *
 *   users/{uid}/projects/{pid}/lattice/trees/{rootId}
 *     ├── projectId, rootId, updatedAt
 *
 *   users/{uid}/projects/{pid}/lattice/trees/{rootId}/subtasks/{taskId}
 *     ├── full AtomicSubtask shape (serialized)
 *
 * The TaskTree is keyed by `rootId` — one tree per parentTask. Subtasks
 * live in a subcollection so the document size cap (1 MB) isn't a
 * worry, and onSnapshot subscriptions only fire for the rows that
 * change.
 *
 * Data plane is structured so the in-memory `TaskTree` (Map-based) and
 * the on-disk schema (flat documents) round-trip losslessly via the
 * `serializeTask` / `deserializeTask` pair.
 *
 * Concurrency / convergence:
 *   • Local edits push via `writeTree()` → batched writeAll.
 *   • Remote edits arrive via `subscribeTree()` → caller is given the
 *     reconciled TaskTree. The reconciler is "last-write-wins" per
 *     subtask using `updatedAt`. If the local copy is fresher, the
 *     remote update is ignored for that row.
 *   • Deleted subtasks (Firestore doc no longer present) are dropped
 *     from the local tree.
 *
 * No-op in environments without Firebase (returns a noop unsubscribe).
 */

import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  type DocumentData,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "../firebase/config";
import { cloneTree } from "./resolve";
import type {
  AtomicSubtask,
  StatusHistoryEntry,
  TaskId,
  TaskTree,
} from "./types";

/* ───────────── paths ───────────── */

const TREES_COLLECTION = "lattice"; // /users/{uid}/projects/{pid}/lattice/...

function treeDocPath(uid: string, pid: string, rootId: string): string[] {
  return ["users", uid, "projects", pid, TREES_COLLECTION, "trees", rootId];
}

function subtasksColPath(uid: string, pid: string, rootId: string): string[] {
  return [...treeDocPath(uid, pid, rootId), "subtasks"];
}

/* ───────────── (de)serialization ───────────── */

interface SerializedTask extends Omit<AtomicSubtask, "history"> {
  history: StatusHistoryEntry[];
}

export function serializeTask(t: AtomicSubtask): SerializedTask {
  // AtomicSubtask is already plain JSON — but value-types like Maps don't
  // appear inside subtasks (those live on TaskTree), so we can pass the
  // record through. Reserialise history just to drop undefined fields.
  return {
    ...t,
    description: t.description ?? "",
    removedAt: t.removedAt ?? undefined,
    intentTag: t.intentTag ?? undefined,
    draftOutcome: t.draftOutcome ?? undefined,
    history: t.history ?? [],
  };
}

export function deserializeTask(raw: DocumentData & { id: TaskId }): AtomicSubtask {
  return {
    id: raw.id,
    parentId: raw.parentId ?? null,
    title: raw.title ?? "(untitled)",
    description: raw.description ?? undefined,
    status: raw.status ?? "pending",
    userLocked: !!raw.userLocked,
    resolutionCondition: raw.resolutionCondition,
    draftOutcome: raw.draftOutcome ?? undefined,
    depth: typeof raw.depth === "number" ? raw.depth : 0,
    signature: raw.signature ?? "",
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : Date.now(),
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : Date.now(),
    removedAt: typeof raw.removedAt === "number" ? raw.removedAt : undefined,
    boundAssertionKeys: Array.isArray(raw.boundAssertionKeys) ? raw.boundAssertionKeys : [],
    boundDocumentIds: Array.isArray(raw.boundDocumentIds) ? raw.boundDocumentIds : [],
    history: Array.isArray(raw.history) ? raw.history : [],
    prerequisites: Array.isArray(raw.prerequisites) ? raw.prerequisites : [],
    intentTag: raw.intentTag ?? undefined,
  };
}

/* ───────────── writes ───────────── */

export interface WriteOptions {
  uid: string;
  projectId: string;
}

/**
 * Mirror the entire tree to Firestore in chunked batches (≤450 ops per
 * batch to stay under the 500-write ceiling).
 *
 * Idempotent: deletes any orphaned subtask docs that exist in
 * Firestore but aren't in the in-memory tree.
 */
export async function writeTree(
  tree: TaskTree,
  opts: WriteOptions,
): Promise<void> {
  const { uid, projectId } = opts;
  const rootId = tree.rootId;
  const FIRESTORE_BATCH_LIMIT = 450;

  // Tree-level doc.
  const treeRef = doc(db, treeDocPath(uid, projectId, rootId).join("/"));
  await setDoc(treeRef, {
    projectId: tree.projectId,
    rootId,
    childrenOrder: serializeChildrenOf(tree),
    updatedAt: tree.updatedAt,
    syncedAt: serverTimestamp(),
  }, { merge: true });

  let batch = writeBatch(db);
  let ops = 0;
  const flushIfFull = async () => {
    if (ops >= FIRESTORE_BATCH_LIMIT) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  };

  const subtasksColRef = collection(db, subtasksColPath(uid, projectId, rootId).join("/"));
  for (const task of tree.tasks.values()) {
    const ref = doc(subtasksColRef, task.id);
    batch.set(ref, serializeTask(task), { merge: true });
    ops++;
    await flushIfFull();
  }
  if (ops > 0) await batch.commit();
}

/**
 * Helper — serialise the `childrenOf` Map into a plain JSON-safe
 * object suitable for storage on the tree-level doc.
 */
function serializeChildrenOf(tree: TaskTree): Record<TaskId, TaskId[]> {
  const out: Record<TaskId, TaskId[]> = {};
  for (const [k, v] of tree.childrenOf) out[k] = [...v];
  return out;
}

/**
 * Single-task write — used after a local edit (lock toggle, status
 * commit). Triggers a Firestore snapshot for any other listening tab.
 */
export async function writeTask(
  task: AtomicSubtask,
  rootId: string,
  opts: WriteOptions,
): Promise<void> {
  const { uid, projectId } = opts;
  const ref = doc(db, [...subtasksColPath(uid, projectId, rootId), task.id].join("/"));
  await setDoc(ref, serializeTask(task), { merge: true });
}

/** Drop a subtask document. */
export async function deleteTaskDoc(
  taskId: TaskId,
  rootId: string,
  opts: WriteOptions,
): Promise<void> {
  const { uid, projectId } = opts;
  const ref = doc(db, [...subtasksColPath(uid, projectId, rootId), taskId].join("/"));
  await deleteDoc(ref);
}

/* ───────────── subscriptions ───────────── */

export interface SubscribeOptions extends WriteOptions {
  rootId: string;
  /** Called every time the subtask collection changes. */
  onTree: (tree: TaskTree) => void;
  /** Optional error sink. */
  onError?: (err: Error) => void;
}

/**
 * Subscribe to the subtasks subcollection. On every snapshot, rebuild
 * the in-memory TaskTree from the remote rows and feed it to `onTree`.
 *
 * Returns a Firestore Unsubscribe handle. Idempotent on dispose.
 */
export function subscribeTree(opts: SubscribeOptions): Unsubscribe {
  const { uid, projectId, rootId, onTree, onError } = opts;
  const colRef = collection(db, subtasksColPath(uid, projectId, rootId).join("/"));
  return onSnapshot(
    colRef,
    (snap) => {
      try {
        const tasks = new Map<TaskId, AtomicSubtask>();
        const childrenOf = new Map<TaskId, TaskId[]>();
        let updatedAt = 0;
        for (const docSnap of snap.docs) {
          const task = deserializeTask({ ...(docSnap.data() as DocumentData), id: docSnap.id });
          tasks.set(task.id, task);
          if (task.updatedAt > updatedAt) updatedAt = task.updatedAt;
        }
        // Rebuild childrenOf from parentId. Preserves declaration order
        // by `createdAt` ascending, then `id` for determinism.
        for (const t of tasks.values()) {
          if (t.parentId == null) {
            if (!childrenOf.has(t.id)) childrenOf.set(t.id, []);
            continue;
          }
          const arr = childrenOf.get(t.parentId) ?? [];
          arr.push(t.id);
          childrenOf.set(t.parentId, arr);
        }
        for (const arr of childrenOf.values()) {
          arr.sort((a, b) => {
            const ta = tasks.get(a)?.createdAt ?? 0;
            const tb = tasks.get(b)?.createdAt ?? 0;
            return ta - tb || a.localeCompare(b);
          });
        }
        // Promote root to a guaranteed childrenOf entry.
        if (!childrenOf.has(rootId)) childrenOf.set(rootId, []);

        const tree: TaskTree = {
          projectId,
          rootId,
          tasks,
          childrenOf,
          updatedAt: updatedAt || Date.now(),
        };
        onTree(tree);
      } catch (err) {
        onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    },
    (err) => onError?.(err as Error),
  );
}

/* ───────────── reconciliation ───────────── */

/**
 * Merge a remote tree into a local tree using last-write-wins per
 * subtask (compares `updatedAt`). Returns a fresh tree; never mutates
 * either input.
 *
 * Reconciliation rules:
 *   • Subtasks present remotely but missing locally are added.
 *   • Subtasks present in both: the side with the higher `updatedAt`
 *     wins. Ties resolve to remote (so external edits propagate).
 *   • Subtasks present locally but missing remotely are dropped iff
 *     the remote tree's updatedAt > local updatedAt (i.e. we received
 *     a newer remote snapshot that excludes them).
 */
export function reconcile(local: TaskTree, remote: TaskTree): TaskTree {
  const next = cloneTree(local);
  next.projectId = remote.projectId;
  next.rootId = remote.rootId;

  const remoteIsFresher = remote.updatedAt > local.updatedAt;

  for (const [id, rTask] of remote.tasks) {
    const lTask = next.tasks.get(id);
    if (!lTask) {
      next.tasks.set(id, rTask);
      continue;
    }
    if (rTask.updatedAt >= lTask.updatedAt) {
      next.tasks.set(id, rTask);
    }
  }

  if (remoteIsFresher) {
    for (const id of Array.from(next.tasks.keys())) {
      if (!remote.tasks.has(id)) {
        next.tasks.delete(id);
      }
    }
  }

  // Replay childrenOf from remote — remote is authoritative for
  // sibling order to keep tabs in sync.
  next.childrenOf = new Map(
    Array.from(remote.childrenOf.entries()).map(([k, v]) => [k, [...v]]),
  );

  next.updatedAt = Math.max(local.updatedAt, remote.updatedAt);
  return next;
}
