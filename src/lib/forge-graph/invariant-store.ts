/**
 * Firestore CRUD for user-saved invariants.
 *
 * Collection: `forge_invariants`
 * Per-document shape mirrors `InvariantConfig` plus an owning project +
 * createdBy uid for rules enforcement. Existing security rules treat
 * this as a project-scoped subdocument; the helper here just talks to
 * the live Firestore SDK.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase/config";
import type { InvariantConfig } from "./invariant-dsl";

const COLLECTION = "forge_invariants";

export type PersistedInvariant = InvariantConfig & {
  projectId: string;
  createdBy: string;
  createdAt: number;
};

export async function createInvariant(args: {
  projectId: string;
  createdBy: string;
  config: InvariantConfig;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Sign-in required to save an invariant.");
  }
  const ref = await addDoc(collection(db, COLLECTION), {
    ownerId: user.uid,
    projectId: args.projectId,
    createdBy: args.createdBy,
    ...args.config,
    // Replace the client-supplied `updatedAt` with the server clock so
    // ordering is consistent across writers.
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateInvariant(
  id: string,
  patch: Partial<InvariantConfig>,
): Promise<void> {
  const ref = doc(db, COLLECTION, id);
  await updateDoc(ref, {
    ...patch,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteInvariant(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}

export async function listProjectInvariants(
  projectId: string,
): Promise<PersistedInvariant[]> {
  // Firestore rules for `forge_invariants` require
  // `resource.data.ownerId == request.auth.uid` on read. For list
  // queries that means our query MUST filter by ownerId — otherwise
  // Firestore can't prove the rule holds for every result and rejects
  // the whole query with "missing or insufficient permissions."
  const user = auth.currentUser;
  if (!user) return [];
  try {
    const q = query(
      collection(db, COLLECTION),
      where("ownerId", "==", user.uid),
      where("projectId", "==", projectId),
      orderBy("updatedAt", "desc"),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const raw = d.data() as Record<string, unknown>;
      return normalise(d.id, raw);
    });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "failed-precondition") {
      console.warn(
        "[forge-graph] Missing composite index for forge_invariants — " +
          "deploy with: firebase deploy --only firestore:indexes",
      );
      return [];
    }
    if (code === "permission-denied") {
      console.warn(
        "[forge-graph] forge_invariants permission denied — verify rules deployed.",
      );
      return [];
    }
    throw err;
  }
}

function normalise(id: string, raw: Record<string, unknown>): PersistedInvariant {
  const updatedAt = readTime(raw.updatedAt);
  const createdAt = readTime(raw.createdAt);
  const base = raw as unknown as InvariantConfig;
  return {
    ...base,
    id,
    updatedAt,
    projectId: String(raw.projectId ?? ""),
    createdBy: String(raw.createdBy ?? ""),
    createdAt,
  } as PersistedInvariant;
}

function readTime(v: unknown): number {
  if (v && typeof v === "object" && typeof (v as { toMillis?: () => number }).toMillis === "function") {
    try {
      return (v as { toMillis: () => number }).toMillis();
    } catch {
      return Date.now();
    }
  }
  if (typeof v === "number") return v;
  return Date.now();
}
