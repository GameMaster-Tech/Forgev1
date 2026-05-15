/**
 * Research Planner — Firestore CRUD.
 *
 * Three collections:
 *   /researchSuggestions/{id}  — pending/accepted/dismissed gaps
 *   /researchPlanItems/{id}    — accepted plan items the user is working through
 *   /plannerWeights/{projectId-ownerId}  — learning state
 *
 * Every write carries denormalised `ownerId` + `projectId` so security
 * rules can authorise in O(1).
 */

import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
  writeBatch,
  increment,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  ALL_KINDS,
  DEFAULT_KIND_WEIGHT,
  type PlanItem,
  type PlanItemStatus,
  type PlannerWeights,
  type Suggestion,
  type SuggestionKind,
  type SuggestionStatus,
} from "./types";

const SUGGESTIONS = "researchSuggestions";
const PLAN_ITEMS = "researchPlanItems";
const WEIGHTS = "plannerWeights";

/* ── Suggestions ─────────────────────────────────────────────── */

export interface CreateSuggestionInput {
  projectId: string;
  ownerId: string;
  kind: SuggestionKind;
  title: string;
  rationale: string;
  proposedAction: string;
  fingerprint: string;
  refs: Suggestion["refs"];
  rawScore: number;
  weightedScore: number;
}

export async function createSuggestion(
  input: CreateSuggestionInput,
): Promise<string> {
  const ref = await addDoc(collection(db, SUGGESTIONS), {
    projectId: input.projectId,
    ownerId: input.ownerId,
    kind: input.kind,
    status: "pending" satisfies SuggestionStatus,
    title: input.title,
    rationale: input.rationale,
    proposedAction: input.proposedAction,
    fingerprint: input.fingerprint,
    refs: input.refs,
    rawScore: input.rawScore,
    weightedScore: input.weightedScore,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function listSuggestions(
  projectId: string,
  ownerId: string,
  status: SuggestionStatus | "all" = "pending",
): Promise<Suggestion[]> {
  try {
    const constraints = [
      where("ownerId", "==", ownerId),
      where("projectId", "==", projectId),
    ];
    if (status !== "all") {
      constraints.push(where("status", "==", status));
    }
    const snap = await getDocs(query(collection(db, SUGGESTIONS), ...constraints));
    const out = snap.docs.map((d) => rowToSuggestion(d.id, d.data()));
    // Client-side sort to avoid composite-index pressure.
    out.sort((a, b) => b.weightedScore - a.weightedScore);
    return out;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "failed-precondition" || code === "permission-denied") return [];
    throw err;
  }
}

export async function getSuggestionByFingerprint(
  projectId: string,
  ownerId: string,
  fingerprint: string,
): Promise<Suggestion | null> {
  try {
    const snap = await getDocs(
      query(
        collection(db, SUGGESTIONS),
        where("ownerId", "==", ownerId),
        where("projectId", "==", projectId),
        where("fingerprint", "==", fingerprint),
      ),
    );
    if (snap.empty) return null;
    const d = snap.docs[0];
    return rowToSuggestion(d.id, d.data());
  } catch {
    return null;
  }
}

export async function markSuggestionStatus(
  suggestionId: string,
  status: SuggestionStatus,
) {
  await updateDoc(doc(db, SUGGESTIONS, suggestionId), {
    status,
    decidedAt: serverTimestamp(),
  });
}

export async function deleteSuggestion(suggestionId: string) {
  await deleteDoc(doc(db, SUGGESTIONS, suggestionId));
}

/* ── Plan items ──────────────────────────────────────────────── */

export interface CreatePlanItemInput {
  projectId: string;
  ownerId: string;
  title: string;
  notes?: string;
  origin: PlanItem["origin"];
  sourceSuggestionId?: string;
  kind?: SuggestionKind;
  refs?: Suggestion["refs"];
}

export async function createPlanItem(input: CreatePlanItemInput): Promise<string> {
  const ref = await addDoc(collection(db, PLAN_ITEMS), {
    projectId: input.projectId,
    ownerId: input.ownerId,
    title: input.title,
    notes: input.notes ?? null,
    status: "open" satisfies PlanItemStatus,
    origin: input.origin,
    sourceSuggestionId: input.sourceSuggestionId ?? null,
    kind: input.kind ?? null,
    refs: input.refs ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function listPlanItems(
  projectId: string,
  ownerId: string,
): Promise<PlanItem[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, PLAN_ITEMS),
        where("ownerId", "==", ownerId),
        where("projectId", "==", projectId),
      ),
    );
    const items = snap.docs.map((d) => rowToPlanItem(d.id, d.data()));
    // Open first, then in-progress, then done, then archived — within
    // each bucket, newest first.
    const rank: Record<PlanItemStatus, number> = {
      open: 0,
      "in-progress": 1,
      done: 2,
      archived: 3,
    };
    items.sort((a, b) => {
      const r = rank[a.status] - rank[b.status];
      if (r !== 0) return r;
      return toMs(b.updatedAt) - toMs(a.updatedAt);
    });
    return items;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "failed-precondition" || code === "permission-denied") return [];
    throw err;
  }
}

export async function updatePlanItem(
  itemId: string,
  data: Partial<Pick<PlanItem, "title" | "notes" | "status">>,
) {
  const patch: Record<string, unknown> = {
    ...data,
    updatedAt: serverTimestamp(),
  };
  if (data.status === "done") patch.completedAt = serverTimestamp();
  await updateDoc(doc(db, PLAN_ITEMS, itemId), patch);
}

export async function deletePlanItem(itemId: string) {
  await deleteDoc(doc(db, PLAN_ITEMS, itemId));
}

/* ── Weights ─────────────────────────────────────────────────── */

function weightsDocId(projectId: string, ownerId: string): string {
  return `${projectId}_${ownerId}`;
}

export async function loadWeights(
  projectId: string,
  ownerId: string,
): Promise<PlannerWeights> {
  const id = weightsDocId(projectId, ownerId);
  const snap = await getDoc(doc(db, WEIGHTS, id));
  if (!snap.exists()) return defaultWeights(projectId, ownerId);
  const data = snap.data();
  return {
    projectId,
    ownerId,
    weights: fillKindMap(data.weights, DEFAULT_KIND_WEIGHT),
    acceptCounts: fillKindMap(data.acceptCounts, 0),
    dismissCounts: fillKindMap(data.dismissCounts, 0),
    updatedAt: data.updatedAt ?? 0,
  };
}

export async function saveWeights(weights: PlannerWeights): Promise<void> {
  const id = weightsDocId(weights.projectId, weights.ownerId);
  await setDoc(
    doc(db, WEIGHTS, id),
    {
      projectId: weights.projectId,
      ownerId: weights.ownerId,
      weights: weights.weights,
      acceptCounts: weights.acceptCounts,
      dismissCounts: weights.dismissCounts,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/* ── Atomic accept / dismiss ─────────────────────────────────── */

/**
 * Accept a suggestion: mark it accepted + create the PlanItem + bump
 * the kind's accept count. Atomic — all-or-nothing.
 */
export async function acceptSuggestion(
  suggestion: Suggestion,
): Promise<string> {
  const planRef = doc(collection(db, PLAN_ITEMS));
  const sugRef = doc(db, SUGGESTIONS, suggestion.id);
  const weightsRef = doc(
    db,
    WEIGHTS,
    weightsDocId(suggestion.projectId, suggestion.ownerId),
  );

  const batch = writeBatch(db);
  batch.set(planRef, {
    projectId: suggestion.projectId,
    ownerId: suggestion.ownerId,
    title: suggestion.proposedAction,
    notes: suggestion.rationale,
    status: "open" satisfies PlanItemStatus,
    origin: "suggestion" satisfies PlanItem["origin"],
    sourceSuggestionId: suggestion.id,
    kind: suggestion.kind,
    refs: suggestion.refs,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.update(sugRef, {
    status: "accepted" satisfies SuggestionStatus,
    decidedAt: serverTimestamp(),
  });
  batch.set(
    weightsRef,
    {
      projectId: suggestion.projectId,
      ownerId: suggestion.ownerId,
      acceptCounts: { [suggestion.kind]: increment(1) },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  await batch.commit();
  return planRef.id;
}

export async function dismissSuggestion(suggestion: Suggestion): Promise<void> {
  const sugRef = doc(db, SUGGESTIONS, suggestion.id);
  const weightsRef = doc(
    db,
    WEIGHTS,
    weightsDocId(suggestion.projectId, suggestion.ownerId),
  );

  const batch = writeBatch(db);
  batch.update(sugRef, {
    status: "dismissed" satisfies SuggestionStatus,
    decidedAt: serverTimestamp(),
  });
  batch.set(
    weightsRef,
    {
      projectId: suggestion.projectId,
      ownerId: suggestion.ownerId,
      dismissCounts: { [suggestion.kind]: increment(1) },
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  await batch.commit();
}

/* ── Helpers ─────────────────────────────────────────────────── */

function rowToSuggestion(id: string, data: DocumentData): Suggestion {
  return {
    id,
    projectId: data.projectId,
    ownerId: data.ownerId,
    kind: data.kind,
    status: data.status,
    title: data.title,
    rationale: data.rationale,
    proposedAction: data.proposedAction,
    fingerprint: data.fingerprint,
    refs: data.refs ?? {},
    rawScore: typeof data.rawScore === "number" ? data.rawScore : 0,
    weightedScore: typeof data.weightedScore === "number" ? data.weightedScore : 0,
    createdAt: data.createdAt ?? 0,
    decidedAt: data.decidedAt ?? undefined,
  };
}

function rowToPlanItem(id: string, data: DocumentData): PlanItem {
  return {
    id,
    projectId: data.projectId,
    ownerId: data.ownerId,
    title: data.title,
    notes: data.notes ?? undefined,
    status: data.status,
    origin: data.origin,
    sourceSuggestionId: data.sourceSuggestionId ?? undefined,
    kind: data.kind ?? undefined,
    refs: data.refs ?? undefined,
    createdAt: data.createdAt ?? 0,
    updatedAt: data.updatedAt ?? 0,
    completedAt: data.completedAt ?? undefined,
  };
}

function defaultWeights(projectId: string, ownerId: string): PlannerWeights {
  const weights: Record<SuggestionKind, number> = {} as Record<SuggestionKind, number>;
  const acceptCounts: Record<SuggestionKind, number> = {} as Record<SuggestionKind, number>;
  const dismissCounts: Record<SuggestionKind, number> = {} as Record<SuggestionKind, number>;
  for (const k of ALL_KINDS) {
    weights[k] = DEFAULT_KIND_WEIGHT;
    acceptCounts[k] = 0;
    dismissCounts[k] = 0;
  }
  return { projectId, ownerId, weights, acceptCounts, dismissCounts, updatedAt: 0 };
}

function fillKindMap<T>(input: unknown, fallback: T): Record<SuggestionKind, T> {
  const source = (input as Record<string, T>) ?? {};
  const out: Record<SuggestionKind, T> = {} as Record<SuggestionKind, T>;
  for (const k of ALL_KINDS) {
    out[k] = source[k] ?? fallback;
  }
  return out;
}

function toMs(t: Timestamp | number): number {
  if (typeof t === "number") return t;
  if (t && typeof t === "object" && "toMillis" in t) return t.toMillis();
  return 0;
}
