/**
 * Counterforge — Firestore CRUD.
 *
 *   /counterforgeCases/{id}     — every counter-case (project-scoped)
 *   /counterforgeSettings/{id}  — id = `${projectId}_${ownerId}`
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
  serverTimestamp,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import {
  DEFAULT_SETTINGS,
  type CounterCase,
  type CounterCaseStatus,
  type CounterEvidence,
  type CounterStrength,
  type CounterforgeSettings,
  type ReadinessScore,
} from "./types";

const CASES = "counterforgeCases";
const SETTINGS = "counterforgeSettings";

/* ── Cases ──────────────────────────────────────────────────── */

export interface CreateCounterCaseInput {
  projectId: string;
  ownerId: string;
  claimText: string;
  claimId?: string;
  documentId?: string;
  paragraphIdx?: number;
  counterArgument: string;
  evidence: CounterEvidence[];
  overallStrength: CounterStrength;
  fingerprint: string;
}

export async function createCounterCase(
  input: CreateCounterCaseInput,
): Promise<string> {
  const ref = await addDoc(collection(db, CASES), {
    projectId: input.projectId,
    ownerId: input.ownerId,
    claimText: input.claimText,
    claimId: input.claimId ?? null,
    documentId: input.documentId ?? null,
    paragraphIdx: input.paragraphIdx ?? null,
    counterArgument: input.counterArgument,
    evidence: input.evidence,
    overallStrength: input.overallStrength,
    status: "open" satisfies CounterCaseStatus,
    fingerprint: input.fingerprint,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function listCounterCases(
  projectId: string,
  ownerId: string,
): Promise<CounterCase[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, CASES),
        where("ownerId", "==", ownerId),
        where("projectId", "==", projectId),
      ),
    );
    const cases = snap.docs.map((d) => rowToCase(d.id, d.data()));
    // Open first (by strength desc), then deferred/stale, then closed.
    const statusRank: Record<CounterCaseStatus, number> = {
      open: 0,
      deferred: 1,
      stale: 2,
      conceded: 3,
      refuted: 4,
    };
    const strengthRank: Record<CounterStrength, number> = {
      strong: 0,
      moderate: 1,
      weak: 2,
    };
    cases.sort((a, b) => {
      const r = statusRank[a.status] - statusRank[b.status];
      if (r !== 0) return r;
      return strengthRank[a.overallStrength] - strengthRank[b.overallStrength];
    });
    return cases;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "failed-precondition" || code === "permission-denied") return [];
    throw err;
  }
}

export async function findCounterCaseByFingerprint(
  projectId: string,
  ownerId: string,
  fingerprint: string,
): Promise<CounterCase | null> {
  try {
    const snap = await getDocs(
      query(
        collection(db, CASES),
        where("ownerId", "==", ownerId),
        where("projectId", "==", projectId),
        where("fingerprint", "==", fingerprint),
      ),
    );
    if (snap.empty) return null;
    return rowToCase(snap.docs[0].id, snap.docs[0].data());
  } catch {
    return null;
  }
}

export async function updateCounterCase(
  caseId: string,
  patch: Partial<
    Pick<
      CounterCase,
      "status" | "resolution" | "concededCaveat" | "refutationSource"
    >
  >,
) {
  const data: Record<string, unknown> = {
    ...patch,
    updatedAt: serverTimestamp(),
  };
  if (patch.status === "refuted" || patch.status === "conceded") {
    data.resolvedAt = serverTimestamp();
  }
  await updateDoc(doc(db, CASES, caseId), data);
}

export async function deleteCounterCase(caseId: string) {
  await deleteDoc(doc(db, CASES, caseId));
}

/* ── Settings ───────────────────────────────────────────────── */

function settingsDocId(projectId: string, ownerId: string): string {
  return `${projectId}_${ownerId}`;
}

export async function loadSettings(
  projectId: string,
  ownerId: string,
): Promise<CounterforgeSettings> {
  const ref = doc(db, SETTINGS, settingsDocId(projectId, ownerId));
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return {
      projectId,
      ownerId,
      ...DEFAULT_SETTINGS,
      updatedAt: 0,
    };
  }
  const data = snap.data();
  return {
    projectId,
    ownerId,
    autoScanIdleMinutes:
      typeof data.autoScanIdleMinutes === "number"
        ? data.autoScanIdleMinutes
        : DEFAULT_SETTINGS.autoScanIdleMinutes,
    surfaceThreshold:
      typeof data.surfaceThreshold === "number"
        ? data.surfaceThreshold
        : DEFAULT_SETTINGS.surfaceThreshold,
    skipWellSupported:
      typeof data.skipWellSupported === "boolean"
        ? data.skipWellSupported
        : DEFAULT_SETTINGS.skipWellSupported,
    updatedAt: data.updatedAt ?? 0,
  };
}

export async function saveSettings(s: CounterforgeSettings): Promise<void> {
  await setDoc(
    doc(db, SETTINGS, settingsDocId(s.projectId, s.ownerId)),
    {
      projectId: s.projectId,
      ownerId: s.ownerId,
      autoScanIdleMinutes: s.autoScanIdleMinutes,
      surfaceThreshold: s.surfaceThreshold,
      skipWellSupported: s.skipWellSupported,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/* ── Readiness ──────────────────────────────────────────────── */

export function computeReadiness(cases: ReadonlyArray<CounterCase>): ReadinessScore {
  let refuted = 0;
  let conceded = 0;
  let open = 0;
  let deferred = 0;
  let stale = 0;
  for (const c of cases) {
    switch (c.status) {
      case "refuted":
        refuted++;
        break;
      case "conceded":
        conceded++;
        break;
      case "open":
        open++;
        break;
      case "deferred":
        deferred++;
        break;
      case "stale":
        stale++;
        break;
    }
  }
  const denom = refuted + conceded + open + deferred;
  const pct = denom === 0 ? 0 : (refuted + conceded) / denom;
  return {
    pct,
    refuted,
    conceded,
    open,
    deferred,
    stale,
    total: cases.length,
  };
}

/* ── Helpers ────────────────────────────────────────────────── */

function rowToCase(id: string, data: DocumentData): CounterCase {
  return {
    id,
    projectId: data.projectId,
    ownerId: data.ownerId,
    claimText: data.claimText ?? "",
    claimId: data.claimId ?? undefined,
    documentId: data.documentId ?? undefined,
    paragraphIdx: data.paragraphIdx ?? undefined,
    counterArgument: data.counterArgument ?? "",
    evidence: Array.isArray(data.evidence) ? (data.evidence as CounterEvidence[]) : [],
    overallStrength: (data.overallStrength as CounterStrength) ?? "moderate",
    status: (data.status as CounterCaseStatus) ?? "open",
    resolution: data.resolution ?? undefined,
    concededCaveat: data.concededCaveat ?? undefined,
    refutationSource: data.refutationSource ?? undefined,
    fingerprint: data.fingerprint ?? "",
    createdAt: data.createdAt ?? 0,
    updatedAt: data.updatedAt ?? 0,
    resolvedAt: data.resolvedAt ?? undefined,
  };
}

function toMs(t: Timestamp | number): number {
  if (typeof t === "number") return t;
  if (t && typeof t === "object" && "toMillis" in t) return t.toMillis();
  return 0;
}
