/**
 * Forge Reactive Workspace — graph persistence.
 *
 * Two distinct write paths:
 *
 *   1. Snapshot write (`saveSnapshot`)
 *      Persists the entire serialised graph to a new
 *      `forge_graph_snapshots` collection. This is an *additive* table,
 *      never mutates existing production schemas, and gives the
 *      Compiler timeline UI a stable record of every simulated and
 *      accepted scenario.
 *
 *   2. Differential write-through (`applyDeltaToSources`)
 *      Walks a `VisualDeltaMap` (post-Tempo, post-acceptance) and
 *      writes each mutation back to its native collection via the
 *      adapter's `origin.collection` pointer:
 *        documents          → updateDocument()
 *        calendar_events    → updateCalendarEvent()
 *        scheduler_*        → noted, future hooks pending Scheduler API
 *
 *      Adapter-owned writes use the existing Firestore helpers so
 *      validation, audit, and security rules continue to apply.
 */

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";
import { updateDocument } from "@/lib/firebase/firestore";
import {
  type ForgeGraphNode,
  type ForgeGraphSnapshot,
  type NodeId,
  type SerialisedGraph,
  type SerialisedNode,
  type VisualDeltaMap,
} from "./types";

const SNAPSHOT_COLLECTION = "forge_graph_snapshots";
const SCHEMA_REV = 1;

/* ───────────────────── snapshot serialisation ───────────────────── */

export function serialiseGraph(graph: Map<NodeId, ForgeGraphNode>): SerialisedGraph {
  const nodes: SerialisedNode[] = [];
  for (const node of graph.values()) {
    nodes.push({
      id: node.id,
      category: node.category,
      payload: {
        title: node.payload.title,
        content: node.payload.content,
        metadata: serialiseMetadata(node.payload.metadata),
      },
      upstreamDependencies: node.upstreamDependencies.slice(),
      downstreamDependencies: node.downstreamDependencies.slice(),
      status: node.status,
      version: node.version,
      origin: { ...node.origin },
      semanticEmbeddingB64: node.semanticEmbedding
        ? encodeFloat32(node.semanticEmbedding)
        : undefined,
    });
  }
  return { nodes, rev: SCHEMA_REV };
}

export function deserialiseGraph(payload: SerialisedGraph): Map<NodeId, ForgeGraphNode> {
  const graph = new Map<NodeId, ForgeGraphNode>();
  for (let i = 0; i < payload.nodes.length; i++) {
    const sn = payload.nodes[i];
    graph.set(sn.id, {
      id: sn.id,
      category: sn.category,
      payload: {
        title: sn.payload.title,
        content: sn.payload.content,
        metadata: deserialiseMetadata(sn.payload.metadata),
      },
      upstreamDependencies: sn.upstreamDependencies.slice(),
      downstreamDependencies: sn.downstreamDependencies.slice(),
      status: sn.status,
      version: sn.version,
      origin: { ...sn.origin },
      semanticEmbedding: sn.semanticEmbeddingB64
        ? decodeFloat32(sn.semanticEmbeddingB64)
        : undefined,
    });
  }
  return graph;
}

/* ───────────────────── snapshot Firestore I/O ───────────────────── */

export async function saveSnapshot(
  projectId: string,
  graph: Map<NodeId, ForgeGraphNode>,
  scenario: string,
  notes?: string,
): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Sign-in required to save a forge-graph snapshot.");
  }
  const payload = serialiseGraph(graph);
  const ref = await addDoc(collection(db, SNAPSHOT_COLLECTION), {
    ownerId: user.uid,
    projectId,
    payload,
    scenario,
    notes: notes ?? null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function loadSnapshot(id: string): Promise<ForgeGraphSnapshot | null> {
  const snap = await getDoc(doc(db, SNAPSHOT_COLLECTION, id));
  if (!snap.exists()) return null;
  const data = snap.data() as {
    projectId: string;
    payload: SerialisedGraph;
    scenario: string;
    notes?: string | null;
    createdAt?: { toMillis?: () => number } | null;
  };
  return {
    id: snap.id,
    projectId: data.projectId,
    payload: data.payload,
    scenario: data.scenario,
    notes: data.notes ?? undefined,
    createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
  };
}

export async function listProjectSnapshots(
  projectId: string,
): Promise<ForgeGraphSnapshot[]> {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    // Rule requires resource.data.ownerId == auth.uid; the query must
    // filter on ownerId so Firestore can prove that before returning.
    const q = query(
      collection(db, SNAPSHOT_COLLECTION),
      where("ownerId", "==", user.uid),
      where("projectId", "==", projectId),
      orderBy("createdAt", "desc"),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data() as {
        projectId: string;
        payload: SerialisedGraph;
        scenario: string;
        notes?: string | null;
        createdAt?: { toMillis?: () => number } | null;
      };
      return {
        id: d.id,
        projectId: data.projectId,
        payload: data.payload,
        scenario: data.scenario,
        notes: data.notes ?? undefined,
        createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
      };
    });
  } catch (err: unknown) {
    // Graceful index-missing fallback — matches the
    // `getProjectDocuments` pattern in firebase/firestore.ts.
    const code = (err as { code?: string }).code ?? "";
    if (code === "failed-precondition") {
      console.warn(
        "[forge-graph] Missing composite index for forge_graph_snapshots — " +
          "deploy with: firebase deploy --only firestore:indexes",
      );
      return [];
    }
    throw err;
  }
}

/* ───────────────────── differential write-through ───────────────────── */

export interface ApplyDeltaResult {
  applied: number;
  skipped: number;
  errors: Array<{ nodeId: NodeId; reason: string }>;
  /** Categories whose write-path is intentionally a no-op today. */
  deferred: NodeId[];
}

/**
 * Apply an accepted `VisualDeltaMap` back to the source collections.
 * Walks the post-Tempo graph (passed in) so we always pick the
 * canonical post-mutation value for each touched field. The compiler's
 * sandbox is discarded; this graph is the system of record.
 */
export async function applyDeltaToSources(
  graph: Map<NodeId, ForgeGraphNode>,
  delta: VisualDeltaMap,
): Promise<ApplyDeltaResult> {
  const result: ApplyDeltaResult = { applied: 0, skipped: 0, errors: [], deferred: [] };
  const touched = new Set<NodeId>();
  for (let i = 0; i < delta.mutations.length; i++) {
    touched.add(delta.mutations[i].nodeId);
  }

  const user = auth.currentUser;
  const uid = user?.uid ?? null;

  for (const nodeId of touched) {
    const node = graph.get(nodeId);
    if (!node) {
      result.skipped += 1;
      continue;
    }
    try {
      const status = await writeNodeToSource(node, uid);
      if (status === "applied") result.applied += 1;
      else if (status === "deferred") result.deferred.push(nodeId);
      else result.skipped += 1;
    } catch (err) {
      result.errors.push({
        nodeId,
        reason: err instanceof Error ? err.message : "unknown error",
      });
    }
  }
  return result;
}

type WriteStatus = "applied" | "deferred" | "skipped";

async function writeNodeToSource(
  node: ForgeGraphNode,
  uid: string | null,
): Promise<WriteStatus> {
  switch (node.origin.collection) {
    case "documents": {
      // Top-level `documents` collection — `updateDocument` is the
      // canonical writer used by the editor everywhere else, so its
      // security rules and side-effects (workspace cache invalidation)
      // come along for free.
      const meta = node.payload.metadata;
      await updateDocument(
        node.origin.externalId,
        {
          title: node.payload.title,
          content: node.payload.content,
          wordCount: typeof meta.wordCount === "number" ? meta.wordCount : undefined,
        },
        node.origin.projectId ?? undefined,
      );
      return "applied";
    }
    case "assertions": {
      // Assertions live at `users/{uid}/projects/{pid}/assertions/{id}`
      // — see `src/app/api/projects/[pid]/export/route.ts`. We need
      // both ids to dispatch; if the snapshot was hydrated without a
      // project we defer.
      if (!uid || !node.origin.projectId) return "deferred";
      const ref = doc(
        db,
        "users",
        uid,
        "projects",
        node.origin.projectId,
        "assertions",
        node.origin.externalId,
      );
      await updateDoc(ref, {
        label: node.payload.title,
        value: node.payload.metadata.value,
        sourcedAt: Date.now(),
      });
      return "applied";
    }
    case "calendar_events":
    case "scheduler_goals":
    case "scheduler_habits":
    case "scheduler_tasks":
      // Forge's calendar grid and Tempo scheduler currently live in the
      // CalendarProvider's in-memory state (see CalendarProvider.tsx)
      // and don't write through to Firestore on every grid mutation.
      // The accepted delta is preserved by the immutable snapshot
      // (`forge_graph_snapshots`) + Tempo-run record (`forge_tempo_runs`);
      // when the calendar persistence layer lands, swap this branch for
      // the actual sub-path writer. Defer instead of failing so the rest
      // of the accept pipeline (snapshot + run record) still succeeds.
      return "deferred";
    case "pulse_blocks":
    case "tiptap_snapshot":
      // PROSE blocks and live TipTap snapshots are write-through via
      // their owning document — there is no separate collection. The
      // companion `documents` mutation will have run already.
      return "skipped";
  }
}

/* ───────────────────── metadata serialisation ───────────────────── */

function serialiseMetadata(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(meta)) {
    const v = meta[key];
    if (v instanceof Date) {
      out[key] = { __forgeDate: v.toISOString() };
    } else if (v instanceof Float32Array) {
      out[key] = { __forgeFloat32: encodeFloat32(v) };
    } else {
      out[key] = v;
    }
  }
  return out;
}

function deserialiseMetadata(
  meta: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(meta)) {
    const v = meta[key];
    if (v && typeof v === "object" && "__forgeDate" in v) {
      out[key] = new Date((v as { __forgeDate: string }).__forgeDate);
    } else if (v && typeof v === "object" && "__forgeFloat32" in v) {
      out[key] = decodeFloat32((v as { __forgeFloat32: string }).__forgeFloat32);
    } else {
      out[key] = v;
    }
  }
  return out;
}

/* ───────────────────── Float32 codec ───────────────────── */

function encodeFloat32(arr: Float32Array): string {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return typeof btoa !== "undefined" ? btoa(bin) : bin;
}

function decodeFloat32(b64: string): Float32Array {
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(b64, "base64");
    return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  }
  const bin = typeof atob !== "undefined" ? atob(b64) : b64;
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}
