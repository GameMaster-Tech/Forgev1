/**
 * Forge Recall — snippet CRUD + correction tracking.
 *
 * Two Firestore collections back this module:
 *   /recallSnippets/{id}     — every Snippet (per-project, denormalised ownerId)
 *   /recallCorrections/{id}  — Correction links
 *
 * Snippets are created passively from chat:
 *   - extractSnippetsFromUserTurn(text)     — splits user msg into snippets
 *   - extractSnippetsFromAssistantTurn(text)— pulls assertions from AI reply
 *   - extractSnippetsFromDoc(doc)           — batch on doc ingest
 *
 * Corrections are created when a user says "actually", "wait", "no",
 * "I meant", etc. and the new snippet semantically opposes a recent
 * snippet. See `detectCorrectionTrigger` + `linkCorrection`.
 */

import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  writeBatch,
  increment,
  type DocumentData,
  type Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import { workspaceCache } from "@/lib/retrieval/cache";
import type { Snippet, SnippetOrigin, Correction } from "./types";

const SNIPPETS = "recallSnippets";
const CORRECTIONS = "recallCorrections";

/* ── Snippet CRUD ────────────────────────────────────────────── */

export interface CreateSnippetInput {
  projectId: string;
  ownerId: string;
  text: string;
  origin: SnippetOrigin;
  sourceRef?: string;
  conversationId?: string;
  pinnedByUser?: boolean;
  embedding?: { vector: number[]; dim: number; modelId: string };
}

export async function createSnippet(input: CreateSnippetInput): Promise<string> {
  const ref = await addDoc(collection(db, SNIPPETS), {
    projectId: input.projectId,
    ownerId: input.ownerId,
    text: input.text.trim(),
    origin: input.origin,
    sourceRef: input.sourceRef ?? null,
    conversationId: input.conversationId ?? null,
    pinnedByUser: !!input.pinnedByUser,
    uses: 0,
    lastUsedAt: 0,
    embedding: input.embedding ?? null,
    createdAt: serverTimestamp(),
  });
  workspaceCache.invalidate(input.projectId);
  return ref.id;
}

export async function getProjectSnippets(
  projectId: string,
  ownerId: string,
): Promise<Snippet[]> {
  try {
    const q = query(
      collection(db, SNIPPETS),
      where("ownerId", "==", ownerId),
      where("projectId", "==", projectId),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => rowToSnippet(d.id, d.data()));
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "permission-denied" || code === "failed-precondition") return [];
    throw err;
  }
}

export async function pinSnippet(snippetId: string, projectId: string) {
  await updateDoc(doc(db, SNIPPETS, snippetId), { pinnedByUser: true });
  workspaceCache.invalidate(projectId);
}

export async function unpinSnippet(snippetId: string, projectId: string) {
  await updateDoc(doc(db, SNIPPETS, snippetId), { pinnedByUser: false });
  workspaceCache.invalidate(projectId);
}

export async function deleteSnippet(snippetId: string, projectId: string) {
  await deleteDoc(doc(db, SNIPPETS, snippetId));
  workspaceCache.invalidate(projectId);
}

/**
 * Record that a snippet was actually used in an answer the user
 * accepted. Bumps `uses` and `lastUsedAt` — that's the entire
 * "freshness" model. No 5-signal salience function.
 */
export async function recordUse(snippetId: string, nowMs: number = Date.now()) {
  await updateDoc(doc(db, SNIPPETS, snippetId), {
    uses: increment(1),
    lastUsedAt: nowMs,
  });
}

/* ── Corrections ─────────────────────────────────────────────── */

const CORRECTION_TRIGGERS = [
  /\b(actually|wait|no,?\s*i\s*meant|i\s*meant|sorry,?\s*i)\b/i,
  /\b(scratch that|correction:|to clarify|let me correct)\b/i,
  /\b(that's wrong|i was wrong|not\s+\w+,?\s*(but|rather)\s+)/i,
];

export function detectCorrectionTrigger(text: string): string | null {
  for (const re of CORRECTION_TRIGGERS) {
    const match = text.match(re);
    if (match) return match[0];
  }
  return null;
}

/**
 * Link two snippets via a correction. The old snippet stays in the
 * store with `supersededBy` filled. Retrieval surfaces both so the
 * AI never echoes the old belief without context.
 */
export async function linkCorrection(input: {
  projectId: string;
  ownerId: string;
  oldSnippetId: string;
  newSnippetId: string;
  trigger: string;
}): Promise<string> {
  const batch = writeBatch(db);
  const correctionRef = doc(collection(db, CORRECTIONS));
  batch.set(correctionRef, {
    projectId: input.projectId,
    ownerId: input.ownerId,
    oldSnippetId: input.oldSnippetId,
    newSnippetId: input.newSnippetId,
    trigger: input.trigger,
    createdAt: serverTimestamp(),
  });
  batch.update(doc(db, SNIPPETS, input.oldSnippetId), {
    supersededBy: input.newSnippetId,
  });
  await batch.commit();
  workspaceCache.invalidate(input.projectId);
  return correctionRef.id;
}

/* ── Passive extraction from chat turns ──────────────────────── */

/**
 * Split a user message into snippet candidates. The rules are
 * intentionally simple — we'd rather over-emit short snippets than
 * miss something. Dedupe happens at retrieval time.
 *
 *   • Sentence-split on .!?
 *   • Drop fragments < 12 chars or > 280 chars
 *   • Drop pure-question sentences (questions aren't facts)
 *   • Keep imperative + declarative
 */
export function extractSnippetsFromUserTurn(text: string): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z])/);
  return sentences
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && s.length <= 280)
    .filter((s) => !s.endsWith("?")); // declarative content only
}

/**
 * Pull factual assertions from an assistant reply. Same logic as
 * user-turn extraction; we mark origin=ai at the call-site.
 */
export function extractSnippetsFromAssistantTurn(text: string): string[] {
  return extractSnippetsFromUserTurn(text);
}

/**
 * Chunked snippet extraction for a long document. Splits on paragraph
 * boundaries first, then sentence-splits each paragraph to keep
 * snippets atomic. Caps the total to avoid blowing up Firestore on
 * big PDFs — caller can paginate if they need more.
 */
export function extractSnippetsFromDoc(
  text: string,
  maxSnippets = 300,
): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const out: string[] = [];
  for (const p of paragraphs) {
    for (const s of extractSnippetsFromUserTurn(p)) {
      out.push(s);
      if (out.length >= maxSnippets) return out;
    }
  }
  return out;
}

/* ── helpers ─────────────────────────────────────────────────── */

function rowToSnippet(id: string, data: DocumentData): Snippet {
  return {
    id,
    projectId: data.projectId,
    ownerId: data.ownerId,
    text: data.text,
    origin: data.origin,
    sourceRef: data.sourceRef ?? undefined,
    conversationId: data.conversationId ?? undefined,
    pinnedByUser: !!data.pinnedByUser,
    uses: data.uses ?? 0,
    lastUsedAt: data.lastUsedAt ?? 0,
    supersededBy: data.supersededBy ?? undefined,
    embedding: data.embedding ?? undefined,
    createdAt: toEpoch(data.createdAt),
  };
}

function toEpoch(t: unknown): number {
  if (typeof t === "number") return t;
  if (t && typeof t === "object" && "toMillis" in t) {
    return (t as Timestamp).toMillis();
  }
  return 0;
}

/* ── single-snippet read used by retrieve.ts ─────────────────── */

export async function getSnippet(snippetId: string): Promise<Snippet | null> {
  const snap = await getDoc(doc(db, SNIPPETS, snippetId));
  if (!snap.exists()) return null;
  return rowToSnippet(snap.id, snap.data());
}

/* ── correction listing used by retrieve.ts ──────────────────── */

export async function getCorrectionsForProject(
  projectId: string,
  ownerId: string,
): Promise<Correction[]> {
  try {
    const q = query(
      collection(db, CORRECTIONS),
      where("projectId", "==", projectId),
    );
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        projectId: data.projectId,
        oldSnippetId: data.oldSnippetId,
        newSnippetId: data.newSnippetId,
        trigger: data.trigger,
        createdAt: toEpoch(data.createdAt),
      };
    });
    // ownerId is enforced by rules — we don't need to refilter client-side.
    void ownerId;
  } catch {
    return [];
  }
}
