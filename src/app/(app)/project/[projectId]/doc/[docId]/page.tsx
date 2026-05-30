"use client";

import { use, useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
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
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useProjectsStore } from "@/store/projects";
import { useAuth } from "@/context/AuthContext";
import {
  getDocument,
  updateDocument,
  type FirestoreDocument,
} from "@/lib/firebase/firestore";
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
import { toastError } from "@/lib/toast";
import type { Editor } from "@tiptap/react";

const ease = [0.22, 0.61, 0.36, 1] as const;

const AUTO_SAVE_DELAY = 2000;

export default function EditorPage({
  params,
}: {
  params: Promise<{ projectId: string; docId: string }>;
}) {
  const { projectId, docId } = use(params);
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
  const [saved, setSaved] = useState(true);
  // `saveError` drives a persistent "Save failed — retry" affordance so the
  // save indicator never gets stuck on "Saving…" when a write fails.
  const [saveError, setSaveError] = useState(false);
  const [editorHtml, setEditorHtml] = useState("");
  const [docError, setDocError] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef("");
  const editorHandleRef = useRef<EditorHandle | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);

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

  // Aria bridge — let the voice agent toggle doc panels and edit the LIVE editor
  // (collab-safe) on the document the user is viewing.
  useEffect(() => {
    const onUi = (e: Event) => {
      const d = (e as CustomEvent<{ kind?: string; panel?: string; mode?: string; content?: string }>).detail;
      if (!d) return;
      if (d.kind === "doc_panel") {
        if (d.panel === "research") openResearch();
        else if (d.panel === "comments") openComments();
        else if (d.panel === "related") openRelated();
      } else if (d.kind === "edit" && typeof d.content === "string") {
        const ed = editorHandleRef.current?.editor;
        if (!ed) return;
        const html = d.content
          .split(/\n{2,}/)
          .map((para) => `<p>${para.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`)
          .join("");
        if (d.mode === "replace") ed.chain().focus().setContent(html).run();
        else if (d.mode === "prepend") ed.chain().focus().setTextSelection(0).insertContent(html).run();
        else ed.chain().focus().setTextSelection(ed.state.doc.content.size).insertContent(html).run();
      }
    };
    window.addEventListener("aria:ui", onUi);
    return () => window.removeEventListener("aria:ui", onUi);
  }, [openResearch, openComments, openRelated]);

  useEffect(() => {
    if (user?.uid) fetchProjects(user.uid);
  }, [user?.uid, fetchProjects]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setDocLoading(true);
      setDocError(false);
      try {
        const doc = await getDocument(docId);
        if (cancelled) return;
        if (doc) {
          setDocData(doc);
          setTitle(doc.title);
          setEditorHtml(doc.content || "");
          setWordCount(doc.wordCount);
          setCitationCount(doc.citationCount);
        } else {
          // Doc genuinely doesn't exist (deleted / bad link) — show an
          // explicit empty/error surface instead of a blank editor.
          setDocError(true);
        }
      } catch (err) {
        console.error("Failed to load document:", err);
        if (!cancelled) {
          setDocError(true);
          toastError(err, "Couldn't load this document.");
        }
      } finally {
        if (!cancelled) setDocLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [docId]);

  const saveToFirestore = useCallback(
    async (content: string, words: number) => {
      try {
        await updateDocument(docId, { content, wordCount: words });
        setSaved(true);
        setSaveError(false);
      } catch (err) {
        // Surface the failure: clear the "Saving…" pulse, flip to a
        // persistent "Save failed" state, and toast once so the writer
        // knows their words aren't safe yet.
        console.error("Auto-save failed:", err);
        setSaveError(true);
        toastError(err, "Couldn't save your changes — we'll keep trying.");
      }
    },
    [docId]
  );

  const retrySave = useCallback(() => {
    setSaveError(false);
    setSaved(false);
    saveToFirestore(latestContentRef.current, wordCount);
  }, [saveToFirestore, wordCount]);

  const handleEditorUpdate = useCallback(
    (html?: string) => {
      setSaved(false);
      if (html !== undefined) latestContentRef.current = html;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveToFirestore(latestContentRef.current, wordCount);
      }, AUTO_SAVE_DELAY);
    },
    [saveToFirestore, wordCount]
  );

  const handleTitleChange = useCallback(
    (newTitle: string) => {
      setTitle(newTitle);
      setSaved(false);
      setSaveError(false);
      updateDocument(docId, { title: newTitle })
        .then(() => {
          setSaved(true);
          setSaveError(false);
        })
        .catch((err) => {
          console.error("Title save failed:", err);
          setSaveError(true);
          toastError(err, "Couldn't save the title.");
        });
    },
    [docId]
  );

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

  if (docError) {
    return (
      <div className="h-screen flex items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <p className="text-[10px] uppercase tracking-[0.22em] text-muted font-medium mb-3">
            Document
          </p>
          <h2 className="font-display font-bold text-foreground text-2xl tracking-[-0.022em] leading-[1.1] mb-3">
            We couldn&apos;t open this <span className="text-rose">document</span>.
          </h2>
          <p className="text-[13px] text-muted leading-relaxed mb-6">
            It may have been deleted, moved, or the link is out of date. Your other
            work is safe.
          </p>
          <Link
            href={project ? `/project/${projectId}` : "/projects"}
            className="inline-flex items-center gap-2 bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
          >
            <ArrowLeft size={12} strokeWidth={2} />
            Back to {project?.name ?? "projects"}
          </Link>
        </div>
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

        {/* Center: save dot — quietly informative, and loud when a save
            actually fails so the writer is never told "Saving…" forever. */}
        <div className="flex items-center gap-1.5">
          {saveError ? (
            <>
              <span aria-hidden className="w-1.5 h-1.5 rounded-full bg-rose" />
              <span className="text-[10px] text-rose tabular-nums">Save failed</span>
              <button
                type="button"
                onClick={retrySave}
                className="text-[10px] text-rose underline underline-offset-2 hover:text-rose/80 transition-colors ml-0.5"
              >
                Retry
              </button>
            </>
          ) : (
            <>
              <span
                aria-hidden
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  saved ? "bg-green/70" : "bg-warm animate-pulse"
                }`}
              />
              <span className="text-[10px] text-muted tabular-nums">
                {saved ? "Saved" : "Saving…"}
              </span>
            </>
          )}
        </div>

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
              onClick={() => setShowMenu(!showMenu)}
              aria-label="More"
              className="p-1.5 text-muted hover:text-foreground hover:bg-foreground/[0.04] rounded transition-colors"
            >
              <MoreHorizontal size={14} strokeWidth={1.75} />
            </button>
            <AnimatePresence>
              {showMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowMenu(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.14 }}
                    className="absolute right-0 top-full mt-1 w-44 bg-background border border-border shadow-[0_16px_32px_-16px_rgba(0,0,0,0.25)] overflow-hidden z-50"
                  >
                    {[
                      { icon: Network, label: "Open graph", href: `/project/${projectId}/graph` },
                      { icon: Download, label: "Export PDF" },
                      { icon: Copy, label: "Duplicate" },
                      { icon: Trash2, label: "Delete", danger: true },
                    ].map((item) => {
                      const Icon = item.icon;
                      const danger = "danger" in item && item.danger;
                      const inner = (
                        <>
                          <Icon size={13} strokeWidth={1.75} />
                          <span>{item.label}</span>
                        </>
                      );
                      const className = `w-full flex items-center gap-2.5 px-3.5 py-2 text-[12px] transition-colors ${
                        danger
                          ? "text-rose/80 hover:text-rose hover:bg-rose/[0.05]"
                          : "text-foreground/80 hover:text-foreground hover:bg-foreground/[0.04]"
                      }`;
                      return "href" in item && item.href ? (
                        <Link
                          key={item.label}
                          href={item.href}
                          onClick={() => setShowMenu(false)}
                          className={className}
                        >
                          {inner}
                        </Link>
                      ) : (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => setShowMenu(false)}
                          className={className}
                        >
                          {inner}
                        </button>
                      );
                    })}
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
            onWordCountChange={setWordCount}
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
    </div>
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
