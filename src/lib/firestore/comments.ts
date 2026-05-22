/**
 * Document comments — Firestore service.
 *
 * Path:
 *   /documents/{docId}/comments/{commentId}
 *   /documents/{docId}/comments/{commentId}/replies/{replyId}
 *
 * Comments anchor to a text selection. The TipTap CommentMark
 * extension carries the `commentId` attribute on the selected range,
 * which is what couples a highlight in the prose to a row in this
 * collection.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase/config";

export interface CommentDoc {
  id: string;
  documentId: string;
  authorId: string;
  authorName: string;
  /** Verbatim text the comment was anchored to (display + jump). */
  anchorText: string;
  body: string;
  createdAt: number;
  resolved: boolean;
  replyCount: number;
}

export interface ReplyDoc {
  id: string;
  commentId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: number;
}

interface CreateCommentInput {
  documentId: string;
  authorId: string;
  authorName: string;
  anchorText: string;
  body: string;
}

/* ───────────── reads (live) ───────────── */

export function subscribeComments(
  documentId: string,
  onChange: (comments: CommentDoc[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    query(
      collection(db, "documents", documentId, "comments"),
      orderBy("createdAt", "asc"),
    ),
    (snap) =>
      onChange(
        snap.docs.map((d) => normaliseComment(d.id, documentId, d.data())),
      ),
    (err) => onError?.(err),
  );
}

export function subscribeReplies(
  documentId: string,
  commentId: string,
  onChange: (replies: ReplyDoc[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    query(
      collection(db, "documents", documentId, "comments", commentId, "replies"),
      orderBy("createdAt", "asc"),
    ),
    (snap) =>
      snap
        ? onChange(
            snap.docs.map((d) => normaliseReply(d.id, commentId, d.data())),
          )
        : null,
    (err) => onError?.(err),
  );
}

/* ───────────── writes ───────────── */

export async function createComment(
  input: CreateCommentInput,
): Promise<string> {
  const ref = await addDoc(
    collection(db, "documents", input.documentId, "comments"),
    {
      documentId: input.documentId,
      authorId: input.authorId,
      authorName: input.authorName,
      anchorText: input.anchorText.slice(0, 280),
      body: input.body.trim(),
      createdAt: serverTimestamp(),
      resolved: false,
      replyCount: 0,
    },
  );
  return ref.id;
}

export async function addReply(input: {
  documentId: string;
  commentId: string;
  authorId: string;
  authorName: string;
  body: string;
}): Promise<string> {
  const ref = await addDoc(
    collection(
      db,
      "documents",
      input.documentId,
      "comments",
      input.commentId,
      "replies",
    ),
    {
      commentId: input.commentId,
      authorId: input.authorId,
      authorName: input.authorName,
      body: input.body.trim(),
      createdAt: serverTimestamp(),
    },
  );
  // Best-effort bump on parent comment's replyCount.
  try {
    const { increment } = await import("firebase/firestore");
    await updateDoc(
      doc(db, "documents", input.documentId, "comments", input.commentId),
      { replyCount: increment(1) },
    );
  } catch {
    /* counter drift is non-fatal; UI re-derives from subscription */
  }
  return ref.id;
}

export async function setCommentResolved(
  documentId: string,
  commentId: string,
  resolved: boolean,
): Promise<void> {
  await updateDoc(doc(db, "documents", documentId, "comments", commentId), {
    resolved,
  });
}

export async function deleteComment(
  documentId: string,
  commentId: string,
): Promise<void> {
  await deleteDoc(doc(db, "documents", documentId, "comments", commentId));
}

/* ───────────── helpers ───────────── */

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

function normaliseComment(
  id: string,
  documentId: string,
  raw: Record<string, unknown> | undefined,
): CommentDoc {
  const data = raw ?? {};
  return {
    id,
    documentId,
    authorId: String(data.authorId ?? ""),
    authorName: String(data.authorName ?? "Unknown"),
    anchorText: String(data.anchorText ?? ""),
    body: String(data.body ?? ""),
    createdAt: readTime(data.createdAt),
    resolved: data.resolved === true,
    replyCount: typeof data.replyCount === "number" ? data.replyCount : 0,
  };
}

function normaliseReply(
  id: string,
  commentId: string,
  raw: Record<string, unknown> | undefined,
): ReplyDoc {
  const data = raw ?? {};
  return {
    id,
    commentId,
    authorId: String(data.authorId ?? ""),
    authorName: String(data.authorName ?? "Unknown"),
    body: String(data.body ?? ""),
    createdAt: readTime(data.createdAt),
  };
}
