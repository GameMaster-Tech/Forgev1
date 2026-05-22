/**
 * Sync — Firestore service.
 *
 * Per-project assertions / constraints / document nodes. Lives under
 * the existing project subtree the rules already cover:
 *
 *   /users/{uid}/projects/{pid}/sync_documents/{docId}
 *   /users/{uid}/projects/{pid}/sync_assertions/{assertionId}
 *   /users/{uid}/projects/{pid}/sync_constraints/{constraintId}
 *
 * The subtree wildcard rule already grants the owner full RW, so no
 * rules deploy is required. Indexes are auto-created for the
 * single-field ordering we use.
 *
 * Why these paths (not /users/{uid}/projects/{pid}/{assertions} like
 * the export route): the export reads/writes flat collection names
 * inside the project doc. We use the same convention here. The
 * `sync_` prefix is to make the purpose explicit when browsing the
 * Firestore console — every collection name on its own is searchable.
 */

import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  writeBatch,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  DependencyGraph,
  type Assertion,
  type ConstraintEdge,
  type DocumentNode,
} from "@/lib/sync";

const ASSERTIONS = "sync_assertions";
const CONSTRAINTS = "sync_constraints";
const DOCUMENTS = "sync_documents";

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

export async function readSyncSnapshot(p: PathParts): Promise<{
  assertions: Assertion[];
  constraints: ConstraintEdge[];
  documents: DocumentNode[];
}> {
  const base = projectPath(p);
  const [assertionsSnap, constraintsSnap, documentsSnap] = await Promise.all([
    getDocs(query(collection(db, `${base}/${ASSERTIONS}`), orderBy("sourcedAt", "desc"))),
    getDocs(collection(db, `${base}/${CONSTRAINTS}`)),
    getDocs(collection(db, `${base}/${DOCUMENTS}`)),
  ]);
  return {
    assertions: assertionsSnap.docs.map((d) => d.data() as Assertion),
    constraints: constraintsSnap.docs.map((d) => d.data() as ConstraintEdge),
    documents: documentsSnap.docs.map((d) => d.data() as DocumentNode),
  };
}

/* ───────────── live subscriptions ───────────── */

export interface SyncSubscriptionPayload {
  assertions: Assertion[];
  constraints: ConstraintEdge[];
  documents: DocumentNode[];
}

/**
 * Subscribe to all three Sync collections for a project. The callback
 * fires once with the initial snapshot, then on every server-confirmed
 * change. Returns a single `Unsubscribe` that detaches all three
 * listeners — call it from your `useEffect` cleanup.
 *
 * Why a single composed listener: re-deriving a `DependencyGraph` is
 * cheap relative to the network round-trips that triggered the
 * change. Snapshot deltas are merged into a shared cache, then a
 * single coalesced re-emit fires after each per-collection event.
 */
export function subscribeSync(
  p: PathParts,
  onChange: (payload: SyncSubscriptionPayload) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  const base = projectPath(p);
  const cache: SyncSubscriptionPayload = {
    assertions: [],
    constraints: [],
    documents: [],
  };

  const emit = () => onChange({ ...cache });

  const handleError = (err: unknown) => {
    onError?.(err);
  };

  const unsubA = onSnapshot(
    query(collection(db, `${base}/${ASSERTIONS}`), orderBy("sourcedAt", "desc")),
    (snap) => {
      cache.assertions = snap.docs.map((d) => d.data() as Assertion);
      emit();
    },
    handleError,
  );
  const unsubC = onSnapshot(
    collection(db, `${base}/${CONSTRAINTS}`),
    (snap) => {
      cache.constraints = snap.docs.map((d) => d.data() as ConstraintEdge);
      emit();
    },
    handleError,
  );
  const unsubD = onSnapshot(
    collection(db, `${base}/${DOCUMENTS}`),
    (snap) => {
      cache.documents = snap.docs.map((d) => d.data() as DocumentNode);
      emit();
    },
    handleError,
  );

  return () => {
    unsubA();
    unsubC();
    unsubD();
  };
}

/* ───────────── writes ───────────── */

export async function upsertAssertion(
  p: PathParts,
  assertion: Assertion,
): Promise<void> {
  const base = projectPath(p);
  await setDoc(
    doc(db, `${base}/${ASSERTIONS}`, assertion.id),
    stripUndefined({ ...assertion, updatedAt: serverTimestamp() }),
    { merge: true },
  );
}

export async function upsertConstraint(
  p: PathParts,
  edge: ConstraintEdge,
): Promise<void> {
  const base = projectPath(p);
  await setDoc(
    doc(db, `${base}/${CONSTRAINTS}`, edge.id),
    stripUndefined({ ...edge, updatedAt: serverTimestamp() }),
    { merge: true },
  );
}

export async function upsertDocumentNode(
  p: PathParts,
  node: DocumentNode,
): Promise<void> {
  const base = projectPath(p);
  await setDoc(
    doc(db, `${base}/${DOCUMENTS}`, node.id),
    stripUndefined({ ...node, updatedAt: serverTimestamp() }),
    { merge: true },
  );
}

/**
 * Apply a `DependencyGraph` to Firestore in a single batched write.
 * Used by the Sync provider's `applyCurrentPatch` to commit the result
 * of the solver. Batches are capped at 450 ops to stay under the 500-op
 * Firestore ceiling.
 */
export async function applyGraphToFirestore(
  p: PathParts,
  graph: DependencyGraph,
): Promise<void> {
  const base = projectPath(p);
  const FIRESTORE_BATCH_LIMIT = 450;

  const assertions = graph.listAssertions();
  const constraints = graph.listConstraints();
  const documents = graph.listDocuments();

  let batch = writeBatch(db);
  let ops = 0;

  const flushIfFull = async () => {
    if (ops >= FIRESTORE_BATCH_LIMIT) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  };

  for (const a of assertions) {
    batch.set(doc(db, `${base}/${ASSERTIONS}`, a.id), stripUndefined(a));
    ops += 1;
    await flushIfFull();
  }
  for (const c of constraints) {
    batch.set(doc(db, `${base}/${CONSTRAINTS}`, c.id), stripUndefined(c));
    ops += 1;
    await flushIfFull();
  }
  for (const d of documents) {
    batch.set(doc(db, `${base}/${DOCUMENTS}`, d.id), stripUndefined(d));
    ops += 1;
    await flushIfFull();
  }
  if (ops > 0) await batch.commit();
}

/* ───────────── hydration ───────────── */

/**
 * Hydrate a `DependencyGraph` from a snapshot payload. Pure — does
 * not touch Firestore. Used by the subscribe hook to fold the live
 * payload back into the same `DependencyGraph` shape the providers
 * already consume.
 */
export function hydrateGraph(
  projectId: string,
  payload: SyncSubscriptionPayload,
): DependencyGraph {
  const g = new DependencyGraph(projectId);
  for (const d of payload.documents) g.upsertDocument(d);
  for (const a of payload.assertions) g.upsertAssertion(a);
  for (const c of payload.constraints) g.upsertConstraint(c);
  return g;
}
