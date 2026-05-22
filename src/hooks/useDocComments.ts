"use client";

/**
 * useDocComments — live comments + reply threads for a document.
 *
 * Subscribes to /documents/{docId}/comments and keeps a per-comment
 * cache of replies. Exposes add / reply / resolve / delete actions
 * that write back to Firestore.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  addReply as addReplyFirestore,
  createComment,
  deleteComment as deleteCommentFirestore,
  setCommentResolved,
  subscribeComments,
  subscribeReplies,
  type CommentDoc,
  type ReplyDoc,
} from "@/lib/firestore/comments";

export interface UseDocCommentsApi {
  comments: CommentDoc[];
  repliesByComment: Map<string, ReplyDoc[]>;
  loading: boolean;
  error: string | null;
  addComment: (input: { anchorText: string; body: string }) => Promise<string | null>;
  addReply: (commentId: string, body: string) => Promise<void>;
  resolveComment: (commentId: string, resolved: boolean) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
}

export function useDocComments(documentId: string | null): UseDocCommentsApi {
  const { user } = useAuth();
  const [comments, setComments] = useState<CommentDoc[]>([]);
  const [repliesByComment, setRepliesByComment] = useState<
    Map<string, ReplyDoc[]>
  >(() => new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Subscribe to the comments list.
  useEffect(() => {
    if (!documentId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setComments([]);
      return;
    }
     
    setLoading(true);
    const unsub = subscribeComments(
      documentId,
      (next) => {
        setComments(next);
        setLoading(false);
      },
      (err) => {
        setError(err instanceof Error ? err.message : "Couldn't load comments.");
        setLoading(false);
      },
    );
    return () => unsub();
  }, [documentId]);

  // Subscribe to replies for every visible comment. Each subscription
  // is per-comment so adding a new comment only spins up that one
  // listener.
  useEffect(() => {
    if (!documentId || comments.length === 0) return;
    const unsubs = comments.map((c) =>
      subscribeReplies(documentId, c.id, (next) => {
        setRepliesByComment((prev) => {
          const out = new Map(prev);
          out.set(c.id, next);
          return out;
        });
      }),
    );
    return () => {
      for (const u of unsubs) u();
    };
  }, [documentId, comments]);

  const addComment = useCallback<UseDocCommentsApi["addComment"]>(
    async ({ anchorText, body }) => {
      if (!documentId || !user?.uid) return null;
      const trimmed = body.trim();
      if (!trimmed) return null;
      try {
        const id = await createComment({
          documentId,
          authorId: user.uid,
          authorName: user.displayName ?? user.email ?? "You",
          anchorText,
          body: trimmed,
        });
        return id;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save comment.");
        return null;
      }
    },
    [documentId, user],
  );

  const addReply = useCallback<UseDocCommentsApi["addReply"]>(
    async (commentId, body) => {
      if (!documentId || !user?.uid) return;
      const trimmed = body.trim();
      if (!trimmed) return;
      try {
        await addReplyFirestore({
          documentId,
          commentId,
          authorId: user.uid,
          authorName: user.displayName ?? user.email ?? "You",
          body: trimmed,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save reply.");
      }
    },
    [documentId, user],
  );

  const resolveComment = useCallback<UseDocCommentsApi["resolveComment"]>(
    async (commentId, resolved) => {
      if (!documentId) return;
      try {
        await setCommentResolved(documentId, commentId, resolved);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't update comment.",
        );
      }
    },
    [documentId],
  );

  const deleteCommentAction = useCallback<UseDocCommentsApi["deleteComment"]>(
    async (commentId) => {
      if (!documentId) return;
      try {
        await deleteCommentFirestore(documentId, commentId);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Couldn't delete comment.",
        );
      }
    },
    [documentId],
  );

  return useMemo(
    () => ({
      comments,
      repliesByComment,
      loading,
      error,
      addComment,
      addReply,
      resolveComment,
      deleteComment: deleteCommentAction,
    }),
    [
      comments,
      repliesByComment,
      loading,
      error,
      addComment,
      addReply,
      resolveComment,
      deleteCommentAction,
    ],
  );
}
