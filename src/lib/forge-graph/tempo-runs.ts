/**
 * Tempo run persistence.
 *
 * Every accepted delta produces a `TempoRunReport`. We write the report
 * (and the snapshot id of the post-tempo graph) into a new
 * `forge_tempo_runs` collection — additive, never mutates production
 * schemas — so the Compiler timeline can replay accepted scenarios.
 */

import {
  addDoc,
  collection,
  getDoc,
  doc,
  orderBy,
  query,
  serverTimestamp,
  where,
  getDocs,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";
import type { TempoRunReport } from "./tempo-advanced";

const RUNS_COLLECTION = "forge_tempo_runs";

export interface PersistedTempoRun {
  id: string;
  projectId: string;
  snapshotId: string;
  scenario: string;
  report: TempoRunReport;
  createdAt: number;
  acceptedBy: string;
}

export async function recordRun(args: {
  projectId: string;
  snapshotId: string;
  scenario: string;
  report: TempoRunReport;
  acceptedBy: string;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Sign-in required to record a Tempo run.");
  }
  const ref = await addDoc(collection(db, RUNS_COLLECTION), {
    ownerId: user.uid,
    projectId: args.projectId,
    snapshotId: args.snapshotId,
    scenario: args.scenario,
    report: args.report,
    acceptedBy: args.acceptedBy,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getRun(id: string): Promise<PersistedTempoRun | null> {
  const snap = await getDoc(doc(db, RUNS_COLLECTION, id));
  if (!snap.exists()) return null;
  const data = snap.data() as {
    projectId: string;
    snapshotId: string;
    scenario: string;
    report: TempoRunReport;
    acceptedBy: string;
    createdAt?: { toMillis?: () => number } | null;
  };
  return {
    id: snap.id,
    projectId: data.projectId,
    snapshotId: data.snapshotId,
    scenario: data.scenario,
    report: data.report,
    acceptedBy: data.acceptedBy,
    createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
  };
}

export async function listProjectRuns(
  projectId: string,
): Promise<PersistedTempoRun[]> {
  const user = auth.currentUser;
  if (!user) return [];
  try {
    // Rule requires resource.data.ownerId == auth.uid; filter on ownerId
    // in the query so Firestore can verify before returning.
    const q = query(
      collection(db, RUNS_COLLECTION),
      where("ownerId", "==", user.uid),
      where("projectId", "==", projectId),
      orderBy("createdAt", "desc"),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data() as {
        projectId: string;
        snapshotId: string;
        scenario: string;
        report: TempoRunReport;
        acceptedBy: string;
        createdAt?: { toMillis?: () => number } | null;
      };
      return {
        id: d.id,
        projectId: data.projectId,
        snapshotId: data.snapshotId,
        scenario: data.scenario,
        report: data.report,
        acceptedBy: data.acceptedBy,
        createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
      };
    });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "failed-precondition") {
      console.warn(
        "[forge-graph] Missing composite index for forge_tempo_runs — " +
          "deploy with: firebase deploy --only firestore:indexes",
      );
      return [];
    }
    throw err;
  }
}
