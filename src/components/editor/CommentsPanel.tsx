"use client";

/**
 * CommentsPanel — right-side panel that lists every comment on the
 * current document with its reply thread + the "+ New comment" entry
 * for the current selection.
 *
 * Pure presentational. State + Firestore wiring live in
 * `useDocComments`; the editor selection handle lives in the parent.
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Check,
  CheckCircle2,
  Loader2,
  MessageSquare,
  Reply,
  Trash2,
  X,
} from "lucide-react";
import type { CommentDoc, ReplyDoc } from "@/lib/firestore/comments";

const EASE = [0.22, 0.61, 0.36, 1] as const;

interface CommentsPanelProps {
  open: boolean;
  onClose: () => void;
  comments: CommentDoc[];
  repliesByComment: Map<string, ReplyDoc[]>;
  loading: boolean;
  /** Verbatim text the current editor selection is anchored to. */
  pendingAnchor: string | null;
  onClearPending: () => void;
  onAddComment: (body: string) => Promise<void>;
  onAddReply: (commentId: string, body: string) => Promise<void>;
  onResolve: (commentId: string, resolved: boolean) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  onJumpToComment: (anchorText: string) => void;
}

export function CommentsPanel({
  open,
  onClose,
  comments,
  repliesByComment,
  loading,
  pendingAnchor,
  onClearPending,
  onAddComment,
  onAddReply,
  onResolve,
  onDelete,
  onJumpToComment,
}: CommentsPanelProps) {
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const newCommentRef = useRef<HTMLTextAreaElement | null>(null);

  // Focus the composer the moment a selection arrives.
  useEffect(() => {
    if (pendingAnchor) newCommentRef.current?.focus();
  }, [pendingAnchor]);

  const submitComment = async () => {
    if (!draft.trim() || submitting) return;
    setSubmitting(true);
    try {
      await onAddComment(draft);
      setDraft("");
      onClearPending();
    } finally {
      setSubmitting(false);
    }
  };

  const visible = comments.filter((c) => (filter === "open" ? !c.resolved : true));

  return (
    <AnimatePresence>
      {open ? (
        <motion.aside
          key="comments-panel"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 12 }}
          transition={{ duration: 0.24, ease: EASE }}
          className="relative h-full w-[340px] shrink-0 border-l border-border bg-surface flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <MessageSquare size={11} strokeWidth={2} className="text-violet" />
            <span className="text-[10px] uppercase tracking-[0.18em] text-violet font-semibold">
              Comments
            </span>
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
              · {visible.length}
            </span>
            <div className="ml-auto flex items-center gap-1">
              <FilterPill
                active={filter === "open"}
                onClick={() => setFilter("open")}
                label="Open"
              />
              <FilterPill
                active={filter === "all"}
                onClick={() => setFilter("all")}
                label="All"
              />
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="p-1.5 text-muted hover:text-foreground transition-colors"
              >
                <X size={12} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {pendingAnchor ? (
              <div className="px-4 pt-4 pb-3 border-b border-border bg-violet/[0.04]">
                <p className="text-[10px] uppercase tracking-[0.16em] text-violet font-semibold mb-2">
                  New comment
                </p>
                <p className="text-[12px] text-muted leading-snug mb-2 line-clamp-2">
                  &ldquo;{pendingAnchor}&rdquo;
                </p>
                <textarea
                  ref={newCommentRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  rows={2}
                  placeholder="Add a comment…"
                  className="w-full resize-none bg-background border border-border focus:border-violet/50 outline-none px-3 py-2 text-[13px] text-foreground placeholder:text-muted leading-relaxed transition-colors"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      void submitComment();
                    }
                    if (e.key === "Escape") {
                      onClearPending();
                      setDraft("");
                    }
                  }}
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[9px] uppercase tracking-[0.14em] text-muted">
                    ⌘/Ctrl+Enter to post
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onClearPending();
                        setDraft("");
                      }}
                      className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-foreground px-2.5 py-1.5 transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={submitComment}
                      disabled={!draft.trim() || submitting}
                      className="inline-flex items-center gap-1.5 bg-violet text-white hover:bg-violet/90 disabled:opacity-50 text-[10px] uppercase tracking-[0.12em] font-semibold px-2.5 py-1.5 transition-colors"
                    >
                      {submitting ? (
                        <Loader2 size={10} className="animate-spin" />
                      ) : null}
                      Post
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {loading && visible.length === 0 ? (
              <div className="flex items-center justify-center py-16 text-[12px] text-muted gap-2">
                <Loader2 size={12} className="animate-spin text-violet" />
                Loading comments…
              </div>
            ) : visible.length === 0 && !pendingAnchor ? (
              <EmptyComments filter={filter} />
            ) : (
              <ul>
                {visible.map((c) => (
                  <CommentThread
                    key={c.id}
                    comment={c}
                    replies={repliesByComment.get(c.id) ?? []}
                    onJump={() => onJumpToComment(c.anchorText)}
                    onReply={(body) => onAddReply(c.id, body)}
                    onResolve={(resolved) => onResolve(c.id, resolved)}
                    onDelete={() => onDelete(c.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

/* ────── filter chips ────── */

function FilterPill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[9px] uppercase tracking-[0.14em] font-semibold px-2 py-1 transition-colors ${
        active ? "text-violet" : "text-muted hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

/* ────── single comment + replies ────── */

function CommentThread({
  comment,
  replies,
  onJump,
  onReply,
  onResolve,
  onDelete,
}: {
  comment: CommentDoc;
  replies: ReplyDoc[];
  onJump: () => void;
  onReply: (body: string) => Promise<void>;
  onResolve: (resolved: boolean) => Promise<void>;
  onDelete: () => void;
}) {
  const [replyDraft, setReplyDraft] = useState("");
  const [replyOpen, setReplyOpen] = useState(false);
  const [replying, setReplying] = useState(false);

  const submitReply = async () => {
    if (!replyDraft.trim() || replying) return;
    setReplying(true);
    try {
      await onReply(replyDraft);
      setReplyDraft("");
      setReplyOpen(false);
    } finally {
      setReplying(false);
    }
  };

  const time = new Date(comment.createdAt).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <li
      className={`px-4 py-4 border-b border-border ${comment.resolved ? "opacity-60" : ""}`}
    >
      {/* Anchor */}
      <button
        type="button"
        onClick={onJump}
        className="group block text-left w-full mb-2"
      >
        <span className="block text-[10px] uppercase tracking-[0.14em] text-muted font-semibold mb-1 group-hover:text-violet transition-colors">
          On
        </span>
        <span className="block text-[12px] text-foreground/85 leading-snug border-l-2 border-violet/30 pl-2 group-hover:border-violet transition-colors line-clamp-2">
          {comment.anchorText}
        </span>
      </button>

      {/* Author + body */}
      <div className="mt-3 flex items-baseline gap-2 mb-1.5 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-foreground">
          {comment.authorName}
        </span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted tabular-nums">
          · {time}
        </span>
        {comment.resolved ? (
          <span className="text-[9px] uppercase tracking-[0.14em] text-green font-semibold inline-flex items-center gap-1">
            <CheckCircle2 size={9} strokeWidth={2.25} />
            Resolved
          </span>
        ) : null}
      </div>
      <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap break-words">
        {comment.body}
      </p>

      {/* Replies */}
      {replies.length > 0 ? (
        <ul className="mt-3 space-y-2 border-l border-border pl-3">
          {replies.map((r) => (
            <li key={r.id}>
              <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
                <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-foreground">
                  {r.authorName}
                </span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-muted tabular-nums">
                  ·{" "}
                  {new Date(r.createdAt).toLocaleString([], {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </div>
              <p className="text-[12.5px] text-foreground/90 leading-relaxed whitespace-pre-wrap break-words">
                {r.body}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {/* Actions */}
      <div className="mt-3 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setReplyOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-violet transition-colors py-1 pr-2"
        >
          <Reply size={10} strokeWidth={2} />
          Reply
        </button>
        <button
          type="button"
          onClick={() => onResolve(!comment.resolved)}
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-green transition-colors py-1 px-2"
        >
          <Check size={10} strokeWidth={2} />
          {comment.resolved ? "Reopen" : "Resolve"}
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete comment"
          className="ml-auto text-muted/60 hover:text-rose transition-colors p-1"
        >
          <Trash2 size={11} strokeWidth={2} />
        </button>
      </div>

      {replyOpen ? (
        <div className="mt-2">
          <textarea
            value={replyDraft}
            onChange={(e) => setReplyDraft(e.target.value)}
            rows={2}
            placeholder="Reply…"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submitReply();
              }
              if (e.key === "Escape") {
                setReplyOpen(false);
                setReplyDraft("");
              }
            }}
            className="w-full resize-none bg-background border border-border focus:border-violet/50 outline-none px-3 py-2 text-[12.5px] text-foreground placeholder:text-muted leading-relaxed transition-colors"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setReplyOpen(false);
                setReplyDraft("");
              }}
              className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-foreground px-2 py-1 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submitReply}
              disabled={!replyDraft.trim() || replying}
              className="inline-flex items-center gap-1.5 bg-violet text-white hover:bg-violet/90 disabled:opacity-50 text-[10px] uppercase tracking-[0.12em] font-semibold px-2.5 py-1 transition-colors"
            >
              {replying ? <Loader2 size={10} className="animate-spin" /> : null}
              Post
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/* ────── empty state ────── */

function EmptyComments({ filter }: { filter: "open" | "all" }) {
  return (
    <div className="px-6 py-12 text-center">
      <MessageSquare
        size={18}
        strokeWidth={1.75}
        className="text-muted mx-auto mb-3"
      />
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold mb-2">
        {filter === "open" ? "No open comments" : "No comments yet"}
      </p>
      <p className="text-[12px] text-muted leading-relaxed max-w-[220px] mx-auto">
        Select any text in the document and click <em>Comment</em> to start a thread.
      </p>
    </div>
  );
}
