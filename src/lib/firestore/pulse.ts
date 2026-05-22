/**
 * Pulse — Firestore service.
 *
 * Per-project ContentBlocks. Lives at:
 *   /users/{uid}/projects/{pid}/pulse_blocks/{blockId}
 *
 * Covered by the existing project-subtree wildcard rule.
 */

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { ContentBlock } from "@/lib/pulse";

const BLOCKS = "pulse_blocks";

interface PathParts {
  uid: string;
  projectId: string;
}

function projectPath({ uid, projectId }: PathParts): string {
  return `users/${uid}/projects/${projectId}`;
}

/** Strip `undefined` values — Firestore rejects them on write. */
function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefined(v)) as unknown as T;
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === undefined) continue;
      out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

/* ───────────── reads ───────────── */

export async function readPulseBlocks(p: PathParts): Promise<ContentBlock[]> {
  const snap = await getDocs(
    query(collection(db, `${projectPath(p)}/${BLOCKS}`)),
  );
  return snap.docs.map((d) => d.data() as ContentBlock);
}

/* ───────────── live subscription ───────────── */

export function subscribePulse(
  p: PathParts,
  onChange: (blocks: ContentBlock[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, `${projectPath(p)}/${BLOCKS}`),
    (snap) => onChange(snap.docs.map((d) => d.data() as ContentBlock)),
    (err) => onError?.(err),
  );
}

/* ───────────── writes ───────────── */

export async function upsertBlock(
  p: PathParts,
  block: ContentBlock,
): Promise<void> {
  await setDoc(
    doc(db, `${projectPath(p)}/${BLOCKS}`, block.id),
    stripUndefined({ ...block, updatedAt: serverTimestamp() }),
    { merge: true },
  );
}

export async function upsertManyBlocks(
  p: PathParts,
  blocks: ContentBlock[],
): Promise<void> {
  const FIRESTORE_BATCH_LIMIT = 450;
  let batch = writeBatch(db);
  let ops = 0;
  for (const b of blocks) {
    batch.set(doc(db, `${projectPath(p)}/${BLOCKS}`, b.id), stripUndefined(b));
    ops += 1;
    if (ops >= FIRESTORE_BATCH_LIMIT) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  }
  if (ops > 0) await batch.commit();
}
