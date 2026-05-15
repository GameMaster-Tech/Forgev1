import {
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  getDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
  writeBatch,
  runTransaction,
  increment,
  type Timestamp,
} from "firebase/firestore";
import { db } from "./config";
import type { ResearchMode } from "@/store/projects";
import { workspaceCache } from "@/lib/retrieval/cache";

/* ─── Types ─── */

export interface FirestoreProject {
  id: string;
  userId: string;
  name: string;
  mode: ResearchMode;
  systemInstructions: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  queryCount: number;
  docCount: number;
  status: "active" | "archived";
  teamId?: string | null;
}

export type TeamRole = "owner" | "admin" | "member" | "viewer";

export interface FirestoreTeam {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  memberIds: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
  projectCount: number;
}

export interface FirestoreTeamMember {
  id: string; // same as userId
  teamId: string;
  userId: string;
  email: string;
  displayName: string;
  role: TeamRole;
  joinedAt: Timestamp;
}

export interface FirestoreTeamInvite {
  id: string;
  teamId: string;
  teamName: string;
  inviterId: string;
  inviterName: string;
  email: string;
  role: TeamRole;
  status: "pending" | "accepted" | "revoked";
  createdAt: Timestamp;
}

export interface FirestoreDocument {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  content: string;
  wordCount: number;
  citationCount: number;
  verifiedCount: number;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/* ─── Projects ─── */

export function isFirebaseOfflineError(err: unknown): boolean {
  const code = (err as { code?: string }).code ?? "";
  const message = err instanceof Error ? err.message : String(err ?? "");

  return (
    code === "unavailable" ||
    code === "unknown" ||
    code === "auth/network-request-failed" ||
    message.includes("client is offline") ||
    message.includes("network-request-failed") ||
    message.includes("Fetching auth token failed")
  );
}

export function firebaseReadErrorMessage(err: unknown): string {
  if (isFirebaseOfflineError(err)) {
    return "Forge could not reach Firebase. Check your internet connection and try again.";
  }

  const code = (err as { code?: string }).code ?? "";
  if (code === "permission-denied") {
    return "Firestore permission denied. Check rules and account access.";
  }

  return "Unable to load workspace data right now.";
}

export async function createProject(
  userId: string,
  data: { name: string; mode: ResearchMode; systemInstructions: string }
) {
  try {
    const ref = await addDoc(collection(db, "projects"), {
      userId,
      name: data.name,
      mode: data.mode,
      systemInstructions: data.systemInstructions,
      queryCount: 0,
      docCount: 0,
      status: "active",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    // Workspace index for the new project starts empty; mark invalid so
    // the first searchWorkspace call builds it from scratch.
    workspaceCache.invalidate(ref.id);
    return ref.id;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "permission-denied" || code === "PERMISSION_DENIED") {
      throw new Error(
        "Firestore permission denied. Deploy security rules: firebase deploy --only firestore:rules"
      );
    }
    if (code === "unavailable" || code === "failed-precondition") {
      throw new Error(
        "Firestore is unreachable. Make sure Firestore is enabled in the Firebase console."
      );
    }
    throw err;
  }
}

export async function getUserProjects(userId: string) {
  try {
    const q = query(
      collection(db, "projects"),
      where("userId", "==", userId),
      orderBy("updatedAt", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as FirestoreProject));
  } catch (err) {
    throw new Error(firebaseReadErrorMessage(err));
  }
}

export async function getProject(projectId: string) {
  try {
    const snap = await getDoc(doc(db, "projects", projectId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as FirestoreProject;
  } catch (err) {
    throw new Error(firebaseReadErrorMessage(err));
  }
}

export async function updateProject(
  projectId: string,
  data: Partial<Pick<FirestoreProject, "name" | "mode" | "systemInstructions" | "queryCount" | "docCount" | "status">>
) {
  await updateDoc(doc(db, "projects", projectId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
  workspaceCache.invalidate(projectId);
}

export async function deleteProject(projectId: string) {
  await deleteDoc(doc(db, "projects", projectId));
  workspaceCache.invalidate(projectId);
}

/* ─── Documents ─── */

export async function createDocument(
  userId: string,
  projectId: string,
  title: string
) {
  try {
    const ref = await addDoc(collection(db, "documents"), {
      userId,
      projectId,
      title,
      content: "",
      wordCount: 0,
      citationCount: 0,
      verifiedCount: 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    // Best-effort doc-count increment. Don't fail the whole create if this
    // fails — the document already exists and the user needs to be routed.
    try {
      const project = await getProject(projectId);
      if (project) {
        await updateProject(projectId, { docCount: project.docCount + 1 });
      }
    } catch (countErr) {
      console.warn("Failed to update project doc count:", countErr);
    }

    workspaceCache.invalidate(projectId);
    return ref.id;
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "permission-denied") {
      throw new Error(
        "Firestore permission denied creating document. Deploy rules: firebase deploy --only firestore:rules",
      );
    }
    throw err;
  }
}

export async function getProjectDocuments(projectId: string, userId?: string) {
  // Firestore rules require owner check per-doc. The query must filter on
  // userId so Firestore can verify the rule at query time without reading
  // every doc — otherwise it returns permission-denied even for owned data.
  try {
    const constraints = userId
      ? [
          where("userId", "==", userId),
          where("projectId", "==", projectId),
          orderBy("updatedAt", "desc"),
        ]
      : [where("projectId", "==", projectId), orderBy("updatedAt", "desc")];

    const q = query(collection(db, "documents"), ...constraints);
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as FirestoreDocument));
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "failed-precondition") {
      console.warn(
        "Firestore index missing for documents query — deploy indexes: firebase deploy --only firestore:indexes",
      );
      return [];
    }
    if (code === "permission-denied") {
      console.warn(
        "Firestore permission denied on documents query. Make sure userId filter is included and rules are deployed.",
      );
      return [];
    }
    if (isFirebaseOfflineError(err)) {
      console.warn(firebaseReadErrorMessage(err));
      return [];
    }
    throw new Error(firebaseReadErrorMessage(err));
  }
}

export async function getDocument(docId: string) {
  try {
    const snap = await getDoc(doc(db, "documents", docId));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() } as FirestoreDocument;
  } catch (err) {
    throw new Error(firebaseReadErrorMessage(err));
  }
}

export async function updateDocument(
  docId: string,
  data: Partial<Pick<FirestoreDocument, "title" | "content" | "wordCount" | "citationCount" | "verifiedCount">>,
  projectId?: string,
) {
  await updateDoc(doc(db, "documents", docId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
  // Invalidate the workspace index so the next search reflects the
  // edit. We accept projectId as an optional arg to avoid a round-trip
  // back to read it; callers in the editor already have it from context.
  // If not supplied we fall back to a one-shot read — slower but safe.
  if (projectId) {
    workspaceCache.invalidate(projectId);
  } else {
    try {
      const snap = await getDoc(doc(db, "documents", docId));
      const pid = snap.exists() ? (snap.data() as FirestoreDocument).projectId : null;
      if (pid) workspaceCache.invalidate(pid);
    } catch {
      /* best effort */
    }
  }
}

export async function deleteDocument(docId: string, projectId: string) {
  await deleteDoc(doc(db, "documents", docId));
  workspaceCache.invalidate(projectId);

  // Decrement project doc count
  const project = await getProject(projectId);
  if (project && project.docCount > 0) {
    await updateProject(projectId, { docCount: project.docCount - 1 });
  }
}

/* ─── Research Queries (for analytics/history) ─── */

export async function saveResearchQuery(
  userId: string,
  projectId: string | null,
  data: { query: string; answer: string; sourceCount: number; verifiedCount: number }
) {
  const ref = await addDoc(collection(db, "queries"), {
    userId,
    projectId,
    query: data.query,
    answer: data.answer,
    sourceCount: data.sourceCount,
    verifiedCount: data.verifiedCount,
    createdAt: serverTimestamp(),
  });
  if (projectId) workspaceCache.invalidate(projectId);
  return ref.id;
}

/* ─── Teams ─── */

export async function createTeam(
  owner: { uid: string; displayName: string; email: string },
  data: { name: string; description: string }
) {
  // ATOMIC. The team doc + the owner's membership row land together —
  // either both succeed or both fail. Avoids the orphaned-team-with-no-
  // owner-row state if the second write fails between two sequential
  // network requests.
  const teamRef = doc(collection(db, "teams"));
  const memberRef = doc(db, "teams", teamRef.id, "members", owner.uid);

  const batch = writeBatch(db);
  batch.set(teamRef, {
    name: data.name,
    description: data.description,
    ownerId: owner.uid,
    memberIds: [owner.uid],
    projectCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  batch.set(memberRef, {
    teamId: teamRef.id,
    userId: owner.uid,
    email: owner.email,
    displayName: owner.displayName || owner.email,
    role: "owner" as TeamRole,
    joinedAt: serverTimestamp(),
  });
  await batch.commit();

  return teamRef.id;
}

export async function getUserTeams(userId: string) {
  const q = query(
    collection(db, "teams"),
    where("memberIds", "array-contains", userId),
    orderBy("updatedAt", "desc")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as FirestoreTeam));
}

export async function getTeam(teamId: string) {
  const snap = await getDoc(doc(db, "teams", teamId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as FirestoreTeam;
}

export async function updateTeam(
  teamId: string,
  data: Partial<Pick<FirestoreTeam, "name" | "description" | "projectCount">>
) {
  await updateDoc(doc(db, "teams", teamId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

export async function deleteTeam(teamId: string) {
  // Use a single batch when small enough; otherwise chunked batches to
  // stay under Firestore's 500-op-per-batch limit. Fail-fast: if any
  // chunk fails the user can retry — partial deletes are tolerable
  // because every cleanup query keys on `teamId` and would re-find
  // any orphans on the next call.
  const FIRESTORE_BATCH_LIMIT = 450;

  const membersSnap = await getDocs(collection(db, "teams", teamId, "members"));
  const invitesSnap = await getDocs(
    query(collection(db, "teamInvites"), where("teamId", "==", teamId))
  );

  let batch = writeBatch(db);
  let ops = 0;
  const flushIfFull = async () => {
    if (ops >= FIRESTORE_BATCH_LIMIT) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  };

  for (const m of membersSnap.docs) {
    batch.delete(m.ref);
    ops++;
    await flushIfFull();
  }
  for (const i of invitesSnap.docs) {
    batch.delete(i.ref);
    ops++;
    await flushIfFull();
  }
  batch.delete(doc(db, "teams", teamId));
  ops++;
  await batch.commit();
}

export async function getTeamMembers(teamId: string) {
  const snap = await getDocs(collection(db, "teams", teamId, "members"));
  return snap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as FirestoreTeamMember)
  );
}

export async function updateTeamMemberRole(
  teamId: string,
  userId: string,
  role: TeamRole
) {
  await updateDoc(doc(db, "teams", teamId, "members", userId), { role });
}

export async function removeTeamMember(teamId: string, userId: string) {
  // ATOMIC. Subdoc deletion + memberIds shrink land together so the
  // denormalised array never drifts.
  const batch = writeBatch(db);
  batch.delete(doc(db, "teams", teamId, "members", userId));
  batch.update(doc(db, "teams", teamId), {
    memberIds: arrayRemove(userId),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
}

/* ─── Team Invites ─── */

export async function createTeamInvite(data: {
  teamId: string;
  teamName: string;
  inviterId: string;
  inviterName: string;
  email: string;
  role: TeamRole;
}) {
  const ref = await addDoc(collection(db, "teamInvites"), {
    teamId: data.teamId,
    teamName: data.teamName,
    inviterId: data.inviterId,
    inviterName: data.inviterName,
    email: data.email.toLowerCase().trim(),
    role: data.role,
    status: "pending",
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function getTeamInvites(teamId: string) {
  const q = query(
    collection(db, "teamInvites"),
    where("teamId", "==", teamId),
    where("status", "==", "pending")
  );
  const snap = await getDocs(q);
  return snap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as FirestoreTeamInvite)
  );
}

export async function getInvitesForEmail(email: string) {
  const q = query(
    collection(db, "teamInvites"),
    where("email", "==", email.toLowerCase().trim()),
    where("status", "==", "pending")
  );
  const snap = await getDocs(q);
  return snap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as FirestoreTeamInvite)
  );
}

export async function revokeTeamInvite(inviteId: string) {
  await updateDoc(doc(db, "teamInvites", inviteId), { status: "revoked" });
}

export async function acceptTeamInvite(
  inviteId: string,
  user: { uid: string; email: string; displayName: string }
) {
  // ATOMIC TRANSACTION. The three writes that used to be sequential
  // (member subdoc + memberIds union + invite status flip) now land as
  // one all-or-nothing transaction. Closes the inconsistency window
  // where a network blip between writes could leave the invite marked
  // accepted but the member never added (or vice versa).
  return runTransaction(db, async (tx) => {
    const inviteRef = doc(db, "teamInvites", inviteId);
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists()) throw new Error("Invite not found");
    const invite = {
      id: inviteSnap.id,
      ...inviteSnap.data(),
    } as FirestoreTeamInvite;
    if (invite.status !== "pending") {
      throw new Error("Invite no longer valid");
    }
    const recipientEmail = user.email.toLowerCase().trim();
    if (invite.email !== recipientEmail) {
      throw new Error("This invite is for a different email address");
    }
    const teamRef = doc(db, "teams", invite.teamId);
    const teamSnap = await tx.get(teamRef);
    if (!teamSnap.exists()) throw new Error("Team no longer exists");
    const team = teamSnap.data() as FirestoreTeam;
    // Idempotency — if the user is somehow already a member, just flip
    // the invite status and return success.
    const alreadyMember = (team.memberIds ?? []).includes(user.uid);
    const memberRef = doc(db, "teams", invite.teamId, "members", user.uid);

    if (!alreadyMember) {
      tx.set(memberRef, {
        teamId: invite.teamId,
        userId: user.uid,
        email: recipientEmail,
        displayName: user.displayName || user.email,
        role: invite.role,
        joinedAt: serverTimestamp(),
      });
      tx.update(teamRef, {
        memberIds: arrayUnion(user.uid),
        updatedAt: serverTimestamp(),
      });
    }
    tx.update(inviteRef, {
      status: "accepted",
      acceptedAt: serverTimestamp(),
      acceptedBy: user.uid,
    });
    return invite.teamId;
  });
}

/* ─── Team Projects (shared projects) ─── */

export async function getTeamProjects(teamId: string) {
  try {
    const q = query(
      collection(db, "projects"),
      where("teamId", "==", teamId),
      orderBy("updatedAt", "desc")
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() } as FirestoreProject));
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "failed-precondition") {
      console.warn(
        "Firestore index missing for team projects query — deploy indexes: firebase deploy --only firestore:indexes"
      );
      return [];
    }
    throw err;
  }
}

export async function assignProjectToTeam(
  projectId: string,
  teamId: string | null
) {
  // ATOMIC. The previous code did two sequential writes (project doc +
  // team.projectCount) AND used a get→increment pattern that was
  // race-prone — two concurrent assigns could double-increment or
  // miss an increment. Use Firestore's atomic `increment()` instead,
  // and wrap the project update + counter touch in a single batch.
  const batch = writeBatch(db);

  // Capture the project's previous teamId so we can decrement the old
  // team's counter if the project moves between teams.
  const prevSnap = await getDoc(doc(db, "projects", projectId));
  const prevTeamId =
    prevSnap.exists() && (prevSnap.data() as FirestoreProject).teamId
      ? ((prevSnap.data() as FirestoreProject).teamId as string)
      : null;

  batch.update(doc(db, "projects", projectId), {
    teamId,
    updatedAt: serverTimestamp(),
  });
  if (prevTeamId && prevTeamId !== teamId) {
    batch.update(doc(db, "teams", prevTeamId), {
      projectCount: increment(-1),
      updatedAt: serverTimestamp(),
    });
  }
  if (teamId && teamId !== prevTeamId) {
    batch.update(doc(db, "teams", teamId), {
      projectCount: increment(1),
      updatedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}
