/**
 * AI conversations + messages — Firestore CRUD.
 *
 * Forge has its own reasoning model (Veritas-R1). The chat surface needs
 * the same shape every modern AI workspace exposes (threads + messages,
 * roles, reasoning content, tool calls, attachments) PLUS the Forge-
 * specific layers (project scoping, mode, claim/citation provenance).
 *
 * Schema rationale
 * ────────────────
 *   /conversations/{conversationId}
 *     ├ userId, projectId         — owner + scope
 *     ├ title                     — auto-summarised on first turn
 *     ├ mode                      — research / write / verify (mirrors project mode)
 *     ├ modelId                   — "veritas-r1" / "veritas-r1-mini" / "claude-3-5-sonnet"
 *     ├ systemPrompt              — optional override; if absent, project's
 *     │                             systemInstructions are used
 *     ├ messageCount              — denormalised, atomic increment on append
 *     ├ lastMessagePreview        — first 200 chars of latest assistant turn
 *     │                             (for the conversation list)
 *     ├ pinned, archived          — UX state
 *     ├ contextSummary            — rolling summary of older turns (filled
 *     │                             by the AI-context pipeline once a
 *     │                             thread exceeds the working window)
 *     ├ createdAt, updatedAt
 *     └ /messages/{messageId} subcollection
 *
 *   /conversations/{conversationId}/messages/{messageId}
 *     ├ role          — "user" | "assistant" | "system" | "tool"
 *     ├ content       — string (markdown/plain) OR structured parts[]
 *     ├ reasoning     — Veritas-R1 chain-of-thought (kept separate from
 *     │                 content; never shown by default; used by recall
 *     │                 to re-prime the model on resume)
 *     ├ toolCalls[]   — { id, name, arguments }
 *     ├ toolResults[] — { toolCallId, output, error? }
 *     ├ citations[]   — { sourceId, doi?, url?, snippet, claimId? }
 *     │                 The claim-graph link is what makes a Forge
 *     │                 message verifiable.
 *     ├ attachments[] — { kind, url, title, projectArtefactRef? }
 *     ├ tokenUsage    — { input, output, reasoning }
 *     ├ stopReason    — "stop" | "length" | "tool_use" | "error"
 *     ├ embedding     — optional inline embedding for cross-conversation recall
 *     ├ createdAt
 *     └ editedAt?
 *
 * Subcollection (not top-level) because:
 *   1. Messages always belong to exactly one conversation; no cross-thread
 *      query ever reads them outside of that scope.
 *   2. Cascade delete on conversation removal is just a chunked subcoll
 *      sweep — no index housekeeping.
 *   3. Firestore rules can use the parent path to authorise.
 *
 * Subcollection trade-off: we lose the ability to do a single project-
 * wide message query without fan-out. The retrieval pipeline handles
 * this by indexing recent conversations into the workspace cache instead
 * of re-querying messages across threads — see `aiContextSearch` in
 * `src/lib/retrieval/ai-context.ts`.
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
  limit as fbLimit,
  serverTimestamp,
  writeBatch,
  increment,
  type Timestamp,
} from "firebase/firestore";
import { db } from "./config";
import { workspaceCache } from "@/lib/retrieval/cache";
import type { ResearchMode } from "@/store/projects";

/* ─── Types ─────────────────────────────────────────────────────── */

export type MessageRole = "user" | "assistant" | "system" | "tool";

export type StopReason = "stop" | "length" | "tool_use" | "content_filter" | "error";

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  output: unknown;
  error?: string;
}

export interface MessageCitation {
  /** Veritas source id (or external) */
  sourceId: string;
  doi?: string;
  url?: string;
  /** Short quote / paraphrase */
  snippet?: string;
  /** Linked claim in the claim graph, if any */
  claimId?: string;
  /** Verification state at the time of the message */
  verified?: boolean;
}

export interface MessageAttachment {
  kind: "document" | "image" | "pdf" | "url" | "claim" | "episode";
  url?: string;
  title?: string;
  /** Reference to a Forge artefact (documentId, claimId, episodeId, etc.) */
  projectArtefactRef?: string;
}

export interface TokenUsage {
  input: number;
  output: number;
  reasoning?: number;
  total?: number;
}

export interface FirestoreConversation {
  id: string;
  userId: string;
  projectId: string;
  title: string;
  mode: ResearchMode;
  modelId: string;
  systemPrompt?: string | null;
  messageCount: number;
  lastMessagePreview: string;
  pinned: boolean;
  archived: boolean;
  contextSummary?: string | null;
  /** Optional set of ids the AI-context tier-3 pipeline should always
   *  include in recall (pinned docs, key claims, etc.) */
  pinnedContextRefs?: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface FirestoreMessage {
  id: string;
  conversationId: string;
  /** Denormalised so subcollection rules can read it without a parent get. */
  userId: string;
  /** Denormalised so retrieval can scope by project without joining. */
  projectId: string;
  role: MessageRole;
  content: string;
  /** Hidden chain-of-thought from Veritas-R1 (or other reasoning models). */
  reasoning?: string | null;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  citations?: MessageCitation[];
  attachments?: MessageAttachment[];
  tokenUsage?: TokenUsage;
  stopReason?: StopReason;
  /** L2-normalised vector for cross-conversation recall. */
  embedding?: { vector: number[]; dim: number; modelId: string };
  modelId?: string;
  createdAt: Timestamp;
  editedAt?: Timestamp | null;
}

/* ─── Conversations CRUD ───────────────────────────────────────── */

export async function createConversation(
  userId: string,
  data: {
    projectId: string;
    title?: string;
    mode: ResearchMode;
    modelId: string;
    systemPrompt?: string;
  },
) {
  const ref = await addDoc(collection(db, "conversations"), {
    userId,
    projectId: data.projectId,
    title: data.title?.trim() || "New conversation",
    mode: data.mode,
    modelId: data.modelId,
    systemPrompt: data.systemPrompt ?? null,
    messageCount: 0,
    lastMessagePreview: "",
    pinned: false,
    archived: false,
    contextSummary: null,
    pinnedContextRefs: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  workspaceCache.invalidate(data.projectId);
  return ref.id;
}

export async function getConversation(conversationId: string) {
  const snap = await getDoc(doc(db, "conversations", conversationId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as FirestoreConversation;
}

export async function getProjectConversations(
  projectId: string,
  userId: string,
  opts: { archived?: boolean; max?: number } = {},
) {
  try {
    const constraints = [
      where("userId", "==", userId),
      where("projectId", "==", projectId),
      where("archived", "==", opts.archived ?? false),
      orderBy("updatedAt", "desc"),
    ];
    const q = query(
      collection(db, "conversations"),
      ...constraints,
      ...(opts.max ? [fbLimit(opts.max)] : []),
    );
    const snap = await getDocs(q);
    return snap.docs.map(
      (d) => ({ id: d.id, ...d.data() } as FirestoreConversation),
    );
  } catch (err: unknown) {
    const code = (err as { code?: string }).code ?? "";
    if (code === "failed-precondition") {
      console.warn(
        "Firestore index missing for conversations query — deploy indexes: firebase deploy --only firestore:indexes",
      );
      return [];
    }
    if (code === "permission-denied") {
      console.warn(
        "Firestore permission denied on conversations query.",
      );
      return [];
    }
    throw err;
  }
}

export async function updateConversation(
  conversationId: string,
  data: Partial<
    Pick<
      FirestoreConversation,
      | "title"
      | "mode"
      | "modelId"
      | "systemPrompt"
      | "pinned"
      | "archived"
      | "contextSummary"
      | "pinnedContextRefs"
    >
  >,
  projectId?: string,
) {
  await updateDoc(doc(db, "conversations", conversationId), {
    ...data,
    updatedAt: serverTimestamp(),
  });
  if (projectId) {
    workspaceCache.invalidate(projectId);
  } else {
    try {
      const snap = await getDoc(doc(db, "conversations", conversationId));
      const pid = snap.exists()
        ? (snap.data() as FirestoreConversation).projectId
        : null;
      if (pid) workspaceCache.invalidate(pid);
    } catch {
      /* best effort */
    }
  }
}

export async function deleteConversation(
  conversationId: string,
  projectId: string,
) {
  // Cascade-delete messages in chunked batches (≤450 ops each) then the
  // parent doc. Firestore caps a batch at 500 — staying under leaves
  // headroom for the parent delete and any retry logic.
  const FIRESTORE_BATCH_LIMIT = 450;

  const messagesSnap = await getDocs(
    collection(db, "conversations", conversationId, "messages"),
  );
  let batch = writeBatch(db);
  let ops = 0;
  for (const m of messagesSnap.docs) {
    batch.delete(m.ref);
    ops++;
    if (ops >= FIRESTORE_BATCH_LIMIT) {
      await batch.commit();
      batch = writeBatch(db);
      ops = 0;
    }
  }
  batch.delete(doc(db, "conversations", conversationId));
  await batch.commit();
  workspaceCache.invalidate(projectId);
}

/* ─── Messages CRUD ────────────────────────────────────────────── */

export async function appendMessage(
  conversationId: string,
  data: {
    userId: string;
    projectId: string;
    role: MessageRole;
    content: string;
    reasoning?: string;
    toolCalls?: ToolCall[];
    toolResults?: ToolResult[];
    citations?: MessageCitation[];
    attachments?: MessageAttachment[];
    tokenUsage?: TokenUsage;
    stopReason?: StopReason;
    embedding?: { vector: number[]; dim: number; modelId: string };
    modelId?: string;
  },
) {
  // Atomic append: write the message, increment count, refresh preview +
  // updatedAt on the parent, all in one batch. Avoids the inconsistent
  // intermediate state where the message exists but the parent's
  // counters/preview don't reflect it.
  const messageRef = doc(
    collection(db, "conversations", conversationId, "messages"),
  );
  const batch = writeBatch(db);
  batch.set(messageRef, {
    conversationId,
    userId: data.userId,
    projectId: data.projectId,
    role: data.role,
    content: data.content,
    reasoning: data.reasoning ?? null,
    toolCalls: data.toolCalls ?? [],
    toolResults: data.toolResults ?? [],
    citations: data.citations ?? [],
    attachments: data.attachments ?? [],
    tokenUsage: data.tokenUsage ?? null,
    stopReason: data.stopReason ?? null,
    embedding: data.embedding ?? null,
    modelId: data.modelId ?? null,
    createdAt: serverTimestamp(),
    editedAt: null,
  });
  // Only the assistant turn drives the preview — user messages are noisy
  // and would just echo their own prompt back into the list.
  const parentPatch: Record<string, unknown> = {
    messageCount: increment(1),
    updatedAt: serverTimestamp(),
  };
  if (data.role === "assistant") {
    parentPatch.lastMessagePreview = data.content.slice(0, 200);
  }
  batch.update(doc(db, "conversations", conversationId), parentPatch);
  await batch.commit();
  workspaceCache.invalidate(data.projectId);
  return messageRef.id;
}

export async function getMessages(
  conversationId: string,
  opts: { max?: number; afterId?: string } = {},
) {
  // Default ascending — chronological order is what UIs render.
  const q = query(
    collection(db, "conversations", conversationId, "messages"),
    orderBy("createdAt", "asc"),
    ...(opts.max ? [fbLimit(opts.max)] : []),
  );
  const snap = await getDocs(q);
  return snap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as FirestoreMessage),
  );
}

/**
 * Tail-N message read for AI-context tier 1.
 *
 * Firestore's `orderBy desc + limit` is the cheap way to get the most
 * recent K messages without scanning the whole subcollection. The
 * caller reverses to chronological order before feeding the model.
 */
export async function getLatestMessages(
  conversationId: string,
  count: number,
) {
  const q = query(
    collection(db, "conversations", conversationId, "messages"),
    orderBy("createdAt", "desc"),
    fbLimit(count),
  );
  const snap = await getDocs(q);
  const rows = snap.docs.map(
    (d) => ({ id: d.id, ...d.data() } as FirestoreMessage),
  );
  return rows.reverse();
}

export async function editMessage(
  conversationId: string,
  messageId: string,
  data: Partial<
    Pick<FirestoreMessage, "content" | "citations" | "attachments" | "reasoning">
  >,
  projectId?: string,
) {
  await updateDoc(
    doc(db, "conversations", conversationId, "messages", messageId),
    {
      ...data,
      editedAt: serverTimestamp(),
    },
  );
  if (projectId) workspaceCache.invalidate(projectId);
}

export async function deleteMessage(
  conversationId: string,
  messageId: string,
  projectId: string,
) {
  // Best-effort: decrement count and delete in a batch. If count drifts
  // we don't lose user data — the count is purely UX.
  const batch = writeBatch(db);
  batch.delete(
    doc(db, "conversations", conversationId, "messages", messageId),
  );
  batch.update(doc(db, "conversations", conversationId), {
    messageCount: increment(-1),
    updatedAt: serverTimestamp(),
  });
  await batch.commit();
  workspaceCache.invalidate(projectId);
}
