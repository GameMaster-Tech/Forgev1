"use client";

import { use, useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  PanelRightClose,
  PanelRightOpen,
  MoreHorizontal,
  Download,
  Trash2,
  Copy,
  Loader2,
  Network,
  MessageSquare,
  GitBranch,
  FileText,
  FileCode,
  ChevronRight,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { useProjectsStore } from "@/store/projects";
import { useAuth } from "@/context/AuthContext";
import {
  getDocument,
  duplicateDocument,
  trashDocument,
  restoreDocument,
  type FirestoreDocument,
} from "@/lib/firebase/firestore";
import { useDocumentAutosave } from "@/hooks/useDocumentAutosave";
import {
  exportDocumentMarkdown,
  exportDocumentHtml,
} from "@/lib/io/document-export";
import { uploadImageWithFallback } from "@/lib/firebase/storage";
import ForgeEditor, {
  type EditorHandle,
} from "@/components/editor/ForgeEditor";
import ResearchSidePanel from "@/components/editor/ResearchSidePanel";
import { ShareLinkButton } from "@/components/editor/ShareLinkButton";
import { CommentsPanel } from "@/components/editor/CommentsPanel";
import { DocumentOutline } from "@/components/editor/DocumentOutline";
import { RelatedDocsPanel } from "@/components/editor/RelatedDocsPanel";
import { useDocComments } from "@/hooks/useDocComments";
import { useCollaborativeDoc } from "@/hooks/useCollaborativeDoc";
import type { Editor } from "@tiptap/react";

const ease = [0.22, 0.61, 0.36, 1] as const;

export default function EditorPage({
  params,
}: {
  params: Promise<{ projectId: string; docId: string }>;
}) {
  const { projectId, docId } = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const { ydoc, synced: collabSynced } = useCollaborativeDoc(docId);
  const project = useProjectsStore((s) => s.getProject(projectId));
  const fetchProjects = useProjectsStore((s) => s.fetchProjects);

  const [, setDocData] = useState<FirestoreDocument | null>(null);
  const [docLoading, setDocLoading] = useState(true);
  const [title, setTitle] = useState("Untitled Document");
  const [researchOpen, setResearchOpen] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [citationCount, setCitationCount] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [editorHtml, setEditorHtml] = useState("");
  const latestContentRef = useRef("");
  const wordCountRef = useRef(0);
  const editorHandleRef = useRef<EditorHandle | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);

  const autosave = useDocumentAutosave(docId, projectId);

  // NOTE: contradiction scanning lives on the /checks page (run from
  // there, not from inside the editor) — keeps the doc surface focused
  // on writing and means a scan only ever fires when the user
  // explicitly asks for one.

  // ── Comments ─────────────────────────────────────────────────
  const commentsApi = useDocComments(docId);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);

  const startComment = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from === to) return; // nothing selected
    const text = editor.state.doc.textBetween(from, to, " ").trim();
    if (!text) return;
    setPendingAnchor(text);
    setCommentsOpen(true);
    setResearchOpen(false);
    setRelatedOpen(false);
  }, [editor]);

  const handleAddComment = useCallback(
    async (body: string) => {
      if (!pendingAnchor || !editor) return;
      const id = await commentsApi.addComment({
        anchorText: pendingAnchor,
        body,
      });
      if (!id) return;
      // Re-select the original anchor and wrap it with the new
      // comment mark so the highlight appears immediately.
      const ok = editorHandleRef.current?.jumpToText(pendingAnchor);
      if (ok) {
        editor.chain().focus().addComment(id).run();
      }
      setPendingAnchor(null);
    },
    [pendingAnchor, editor, commentsApi],
  );

  const openComments = useCallback(() => {
    setResearchOpen(false);
    setRelatedOpen(false);
    setCommentsOpen((v) => !v);
  }, []);

  const openRelated = useCallback(() => {
    setResearchOpen(false);
    setCommentsOpen(false);
    setRelatedOpen((v) => !v);
  }, []);

  // Track whether the editor currently has a non-empty selection so
  // the "Comment" toolbar affordance lights up only when actionable.
  const [hasSelection, setHasSelection] = useState(false);
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const { from, to } = editor.state.selection;
      setHasSelection(from !== to);
    };
    editor.on("selectionUpdate", update);
    editor.on("blur", update);
    update();
    return () => {
      editor.off("selectionUpdate", update);
      editor.off("blur", update);
    };
  }, [editor]);

  const openResearch = useCallback(() => {
    setCommentsOpen(false);
    setRelatedOpen(false);
    setResearchOpen((v) => !v);
  }, []);

  useEffect(() => {
    if (user?.uid) fetchProjects(user.uid);
  }, [user?.uid, fetchProjects]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setDocLoading(true);
      try {
        const doc = await getDocument(docId);
        if (!cancelled && doc) {
          setDocData(doc);
          setTitle(doc.title);
          setEditorHtml(doc.content || "");
          latestContentRef.current = doc.content || "";
          setWordCount(doc.wordCount);
          setCitationCount(doc.citationCount);
          // Seed the autosave revision cursor so the first optimistic
          // write lands cleanly instead of registering a false conflict.
          autosave.init(doc.rev ?? 0);
        }
      } catch (err) {
        console.error("Failed to load document:", err);
      } finally {
        if (!cancelled) setDocLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
    // autosave.init is a stable useCallback; intentionally not a dep so a
    // reload doesn't re-trigger the whole load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId]);

  const handleWordCount = useCallback((count: number) => {
    wordCountRef.current = count;
    setWordCount(count);
  }, []);

  // Upload pasted/dropped images to Storage (data-URL fallback offline).
  const handleImageUpload = useCallback(
    async (file: File): Promise<string | null> => {
      if (!user?.uid) return null;
      const result = await uploadImageWithFallback(user.uid, docId, file);
      if (result?.fallback) {
        toast.message("Embedded image inline", {
          description: "Storage was unavailable, so the image is stored in the document itself.",
        });
      }
      return result?.url ?? null;
    },
    [user?.uid, docId],
  );

  const handleEditorUpdate = useCallback(
    (html?: string) => {
      if (html !== undefined) latestContentRef.current = html;
      autosave.queueContent(latestContentRef.current, wordCountRef.current);
    },
    [autosave],
  );

  const handleTitleChange = useCallback(
    (newTitle: string) => {
      setTitle(newTitle);
      autosave.queueTitle(newTitle);
    },
    [autosave],
  );

  // ── Overflow-menu actions ────────────────────────────────────
  const currentHtml = useCallback(
    () => editor?.getHTML() ?? latestContentRef.current ?? editorHtml,
    [editor, editorHtml],
  );

  const handleExportMarkdown = useCallback(() => {
    exportDocumentMarkdown(title, currentHtml());
    setExportOpen(false);
    setShowMenu(false);
    toast.success("Exported Markdown");
  }, [title, currentHtml]);

  const handleExportHtml = useCallback(() => {
    exportDocumentHtml(title, currentHtml());
    setExportOpen(false);
    setShowMenu(false);
    toast.success("Exported HTML");
  }, [title, currentHtml]);

  const handleDuplicate = useCallback(async () => {
    if (actionBusy) return;
    setActionBusy(true);
    // Flush any pending edit first so the copy reflects the latest text.
    autosave.flush();
    try {
      const newId = await duplicateDocument(docId);
      setShowMenu(false);
      toast.success("Document duplicated");
      router.push(`/project/${projectId}/doc/${newId}`);
    } catch (err) {
      console.error("Duplicate failed:", err);
      toast.error("Couldn't duplicate this document");
    } finally {
      setActionBusy(false);
    }
  }, [actionBusy, autosave, docId, projectId, router]);

  const handleDelete = useCallback(async () => {
    if (actionBusy) return;
    setActionBusy(true);
    try {
      await trashDocument(docId, projectId);
      setConfirmDelete(false);
      setShowMenu(false);
      toast.success("Moved to Trash", {
        description: "Recover it any time from Settings → Trash.",
        action: {
          label: "Undo",
          onClick: () => {
            restoreDocument(docId, projectId)
              .then(() => {
                toast.success("Document restored");
                router.push(`/project/${projectId}/doc/${docId}`);
              })
              .catch(() => toast.error("Couldn't undo"));
          },
        },
      });
      router.push(`/project/${projectId}`);
    } catch (err) {
      console.error("Delete failed:", err);
      toast.error("Couldn't delete this document");
      setActionBusy(false);
    }
  }, [actionBusy, docId, projectId, router]);

  const handleInsertCitation = useCallback(
    (citation: { title: string; doi?: string; url: string; text: string }) => {
      void citation;
      setCitationCount((c) => c + 1);
    },
    []
  );

  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  if (docLoading) {
    return (
      <div className="h-screen flex items-center justify-center relative">
        <div className="fixed inset-0 pointer-events-none" />
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4, ease }}
          className="relative flex flex-col items-center gap-4 bg-white/80 dark:bg-surface/80 backdrop-blur-sm border border-border px-14 py-12"
        >
          <Loader2 size={22} className="text-violet animate-spin" />
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted">
            Loading document
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden relative">
      {/* Chromatic bg */}
      <div className="fixed inset-0 pointer-events-none" />

      {/* Dot grid */}
      <div
        className="fixed inset-0 opacity-[0.03] dark:opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, var(--foreground) 0.5px, transparent 0)",
          backgroundSize: "30px 30px",
        }}
      />

      {/* ── Top bar — minimal, 44px ─────────────────────────────
          Stripped down to the essentials: breadcrumb, save dot,
          three primary icon affordances + an overflow menu. Every
          button is icon-only, neutral coloured, with hover-tinted
          violet on activation. Active panels get a 2px violet bar
          underneath the icon, not a fill — that keeps the writing
          surface visually unaffected when nothing is open. */}
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease }}
        className="relative z-20 h-11 flex items-center justify-between px-4 border-b border-border bg-background/85 backdrop-blur-md shrink-0"
      >
        {/* Left: breadcrumb */}
        <Link
          href={project ? `/project/${projectId}` : "/projects"}
          className="flex items-center gap-1.5 text-[12px] text-muted hover:text-foreground transition-colors min-w-0"
        >
          <ArrowLeft size={13} strokeWidth={1.75} className="shrink-0" />
          <span className="truncate max-w-[200px]">
            {project?.name || "Dashboard"}
          </span>
        </Link>

        {/* Center: honest save status — reflects every autosave state. */}
        <SaveStatusIndicator
          status={autosave.status}
          onRetry={autosave.retry}
          onResolveConflict={autosave.resolveKeepMine}
        />

        {/* Right: icon-only affordances */}
        <div className="flex items-center gap-0.5">
          <ToolIconButton
            icon={MessageSquare}
            label={hasSelection ? "Comment on selection" : "Open comments"}
            active={commentsOpen}
            onClick={hasSelection ? startComment : openComments}
            hasDot={commentsApi.comments.some((c) => !c.resolved)}
          />
          <ToolIconButton
            icon={GitBranch}
            label="Related documents"
            active={relatedOpen}
            onClick={openRelated}
          />
          <ToolIconButton
            icon={researchOpen ? PanelRightClose : PanelRightOpen}
            label="Research"
            active={researchOpen}
            onClick={openResearch}
          />
          <ShareLinkButton documentId={docId} />
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowMenu((v) => !v);
                setExportOpen(false);
              }}
              aria-label="More"
              aria-expanded={showMenu}
              className="p-1.5 text-muted hover:text-foreground hover:bg-foreground/[0.04] rounded transition-colors"
            >
              <MoreHorizontal size={14} strokeWidth={1.75} />
            </button>
            <AnimatePresence>
              {showMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => {
                      setShowMenu(false);
                      setExportOpen(false);
                    }}
                  />
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.14 }}
                    className="absolute right-0 top-full mt-1 w-52 bg-background border border-border shadow-[0_16px_32px_-16px_rgba(0,0,0,0.25)] overflow-hidden z-50"
                  >
                    <Link
                      href={`/project/${projectId}/graph`}
                      onClick={() => setShowMenu(false)}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                    >
                      <Network size={13} strokeWidth={1.75} />
                      <span>Open graph</span>
                    </Link>

                    {/* Export — expandable to Markdown / HTML */}
                    <button
                      type="button"
                      onClick={() => setExportOpen((v) => !v)}
                      aria-expanded={exportOpen}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                    >
                      <Download size={13} strokeWidth={1.75} />
                      <span className="flex-1 text-left">Export</span>
                      <ChevronRight
                        size={12}
                        strokeWidth={2}
                        className={`transition-transform ${exportOpen ? "rotate-90" : ""}`}
                      />
                    </button>
                    <AnimatePresence>
                      {exportOpen && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.16 }}
                          className="overflow-hidden bg-surface/60 border-y border-border"
                        >
                          <button
                            type="button"
                            onClick={handleExportMarkdown}
                            className="w-full flex items-center gap-2.5 pl-8 pr-3.5 py-2 text-[12px] text-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                          >
                            <FileText size={13} strokeWidth={1.75} />
                            <span>Markdown (.md)</span>
                          </button>
                          <button
                            type="button"
                            onClick={handleExportHtml}
                            className="w-full flex items-center gap-2.5 pl-8 pr-3.5 py-2 text-[12px] text-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] transition-colors"
                          >
                            <FileCode size={13} strokeWidth={1.75} />
                            <span>HTML (.html)</span>
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <button
                      type="button"
                      onClick={handleDuplicate}
                      disabled={actionBusy}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-foreground/80 hover:text-foreground hover:bg-foreground/[0.04] transition-colors disabled:opacity-50"
                    >
                      {actionBusy ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Copy size={13} strokeWidth={1.75} />
                      )}
                      <span>Duplicate</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setConfirmDelete(true);
                        setShowMenu(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] text-rose/80 hover:text-rose hover:bg-rose/[0.05] transition-colors border-t border-border"
                    >
                      <Trash2 size={13} strokeWidth={1.75} />
                      <span>Delete</span>
                    </button>
                  </motion.div>
                </>
              )}
            </AnimatePresence>
          </div>
        </div>
      </motion.div>

      {/* ── Workspace ── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Live table-of-contents rail (xl+, hides itself when <2 headings) */}
        <DocumentOutline editor={editor} />

        <motion.div
          className="flex-1 flex flex-col overflow-hidden min-w-0"
          layout
          transition={{ duration: 0.25, ease }}
        >
          {/* Editable title */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease, delay: 0.05 }}
            className="px-8 pt-10 pb-3 max-w-4xl mx-auto w-full"
          >
            <div className="text-[10px] uppercase tracking-[0.25em] text-violet mb-3 flex items-center gap-2">
              ⁂ Document
              <span className="h-px flex-1 bg-border" />
              <span className="text-muted tabular-nums">
                {title.length} chars
              </span>
            </div>
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Untitled document"
              className="w-full bg-transparent font-display text-[clamp(2rem,4.5vw,2.75rem)] text-foreground placeholder:text-muted/30 focus:outline-none tracking-[-0.03em] leading-[1.05]"
            />
          </motion.div>

          <ForgeEditor
            content={editorHtml}
            ydoc={ydoc}
            collabSynced={collabSynced}
            onUpdate={handleEditorUpdate}
            onWordCountChange={handleWordCount}
            onImageUpload={handleImageUpload}
            onReady={(handle) => {
              editorHandleRef.current = handle;
              setEditor(handle.editor);
            }}
          />
        </motion.div>

        {/* Side panels (mutually exclusive). Quiet 1px border —
            no decorative gradient — keeps focus on the editor. */}
        <div className="relative">
          {(researchOpen || commentsOpen || relatedOpen) && (
            <div className="absolute top-0 left-0 bottom-0 w-px bg-border z-10" />
          )}
          <RelatedDocsPanel
            open={relatedOpen}
            onClose={() => setRelatedOpen(false)}
            projectId={projectId}
            docId={docId}
            probe={`${title}\n${editorHandleRef.current?.getPlainText() ?? ""}`}
          />
          <ResearchSidePanel
            open={researchOpen}
            onClose={() => setResearchOpen(false)}
            onInsertCitation={handleInsertCitation}
            projectId={projectId}
          />
          <CommentsPanel
            open={commentsOpen}
            onClose={() => {
              setCommentsOpen(false);
              setPendingAnchor(null);
            }}
            comments={commentsApi.comments}
            repliesByComment={commentsApi.repliesByComment}
            loading={commentsApi.loading}
            pendingAnchor={pendingAnchor}
            onClearPending={() => setPendingAnchor(null)}
            onAddComment={handleAddComment}
            onAddReply={commentsApi.addReply}
            onResolve={commentsApi.resolveComment}
            onDelete={commentsApi.deleteComment}
            onJumpToComment={(text) => editorHandleRef.current?.jumpToText(text)}
          />
        </div>
      </div>

      {/* ── Bottom footer — one quiet line. ────────────────────── */}
      <div className="relative z-20 shrink-0 h-8 flex items-center justify-end px-5 border-t border-border bg-background/60 text-[10.5px] text-muted tabular-nums gap-3">
        <span>{wordCount.toLocaleString()} words</span>
        <span className="text-border">·</span>
        <span>{readingTime} min read</span>
        {citationCount > 0 ? (
          <>
            <span className="text-border">·</span>
            <span>{citationCount} cited</span>
          </>
        ) : null}
      </div>

      {/* ── Delete confirmation ───────────────────────────────── */}
      <DeleteConfirmModal
        open={confirmDelete}
        title={title}
        busy={actionBusy}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={handleDelete}
      />
    </div>
  );
}

/**
 * SaveStatusIndicator — honest, never-lying autosave status. Each state
 * gets its own colour + copy; error and conflict expose an inline action
 * so the user can recover without leaving the editor.
 */
function SaveStatusIndicator({
  status,
  onRetry,
  onResolveConflict,
}: {
  status: import("@/hooks/useDocumentAutosave").AutosaveStatus;
  onRetry: () => void;
  onResolveConflict: () => void;
}) {
  const map = {
    saved: { dot: "bg-green/70", label: "Saved", pulse: false },
    dirty: { dot: "bg-warm", label: "Unsaved", pulse: false },
    saving: { dot: "bg-warm animate-pulse", label: "Saving…", pulse: true },
    error: { dot: "bg-red", label: "Save failed", pulse: false },
    conflict: { dot: "bg-red", label: "Edited elsewhere", pulse: false },
  } as const;
  const s = map[status];
  return (
    <div className="flex items-center gap-1.5">
      <span aria-hidden className={`w-1.5 h-1.5 rounded-full transition-colors ${s.dot}`} />
      <span className="text-[10px] text-muted tabular-nums">{s.label}</span>
      {status === "error" ? (
        <button
          type="button"
          onClick={onRetry}
          className="ml-1 inline-flex items-center gap-1 text-[10px] text-violet hover:text-violet/80 transition-colors"
        >
          <RefreshCw size={10} strokeWidth={2} />
          Retry
        </button>
      ) : null}
      {status === "conflict" ? (
        <button
          type="button"
          onClick={onResolveConflict}
          className="ml-1 inline-flex items-center gap-1 text-[10px] text-violet hover:text-violet/80 transition-colors"
          title="Overwrite the other change with your current version"
        >
          Keep mine
        </button>
      ) : null}
    </div>
  );
}

/**
 * DeleteConfirmModal — guards the destructive (soft-delete) action.
 * Square-edged, violet/rose accented, focus-friendly. Deleting moves the
 * doc to Trash, so the copy reassures the user it's recoverable.
 */
function DeleteConfirmModal({
  open,
  title,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            className="fixed inset-0 z-[60] bg-foreground/30 backdrop-blur-sm"
            onClick={busy ? undefined : onCancel}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Delete document"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: 0.18, ease }}
            className="fixed left-1/2 top-1/2 z-[61] w-[min(92vw,26rem)] -translate-x-1/2 -translate-y-1/2 border border-border bg-background shadow-[0_32px_80px_-32px_rgba(0,0,0,0.5)]"
          >
            <div className="px-6 pt-6 pb-5">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 border border-rose/40 bg-rose/[0.06] flex items-center justify-center shrink-0">
                  <AlertTriangle size={16} className="text-rose" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-display font-bold text-[18px] text-foreground tracking-[-0.02em]">
                    Delete this document?
                  </h2>
                  <p className="text-[12.5px] text-muted mt-1.5 leading-relaxed">
                    <span className="text-foreground/80 font-medium">
                      {title || "Untitled document"}
                    </span>{" "}
                    will move to Trash. You can restore it any time from
                    Settings → Trash — nothing is permanently lost.
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border bg-surface/50">
              <button
                type="button"
                onClick={onCancel}
                disabled={busy}
                className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-foreground px-4 py-2 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onConfirm}
                disabled={busy}
                className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] font-semibold text-white bg-rose hover:bg-rose/90 px-4 py-2 transition-colors disabled:opacity-50"
              >
                {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                Move to Trash
              </button>
            </div>
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * ToolIconButton — uniform icon-only affordance for the doc toolbar.
 * Inactive: muted icon, hover lifts to foreground + soft fill.
 * Active: violet icon with a 2px violet underline so the writing
 * surface itself isn't visually disturbed.
 */
function ToolIconButton({
  icon: Icon,
  label,
  active,
  onClick,
  hasDot,
}: {
  icon: typeof MessageSquare;
  label: string;
  active?: boolean;
  onClick: () => void;
  hasDot?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`relative p-1.5 rounded transition-colors ${
        active
          ? "text-violet bg-violet/[0.08]"
          : "text-muted hover:text-foreground hover:bg-foreground/[0.04]"
      }`}
    >
      <Icon size={14} strokeWidth={1.75} />
      {hasDot ? (
        <span
          aria-hidden
          className="absolute top-1 right-1 w-1.5 h-1.5 bg-warm rounded-full"
        />
      ) : null}
      {active ? (
        <span
          aria-hidden
          className="absolute left-1.5 right-1.5 -bottom-px h-[2px] bg-violet"
        />
      ) : null}
    </button>
  );
}
