"use client";

import { use, useState, useCallback, useEffect, useRef } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  PanelRightClose,
  PanelRightOpen,
  FileText,
  ShieldCheck,
  Zap,
  Brain,
  Microscope,
  MoreHorizontal,
  Download,
  Trash2,
  Copy,
  BookOpen,
  Loader2,
  Network,
  Flag,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useProjectsStore, type ResearchMode } from "@/store/projects";
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
import ClaimCheckPanel from "@/components/editor/ClaimCheckPanel";
import { ShareLinkButton } from "@/components/editor/ShareLinkButton";
import { ContradictionBanner } from "@/components/editor/ContradictionBanner";
import { useDocContradictions } from "@/hooks/useDocContradictions";
import { CommentsPanel } from "@/components/editor/CommentsPanel";
import { useDocComments } from "@/hooks/useDocComments";
import type { Editor } from "@tiptap/react";
import { MessageSquare, AlertTriangle } from "lucide-react";

const ease = [0.22, 0.61, 0.36, 1] as const;

const modeIcons: Record<ResearchMode, typeof Zap> = {
  lightning: Zap,
  reasoning: Brain,
  deep: Microscope,
};

const modeLabels: Record<ResearchMode, string> = {
  lightning: "Lightning",
  reasoning: "Reasoning",
  deep: "Deep",
};

const modeSolidBg: Record<ResearchMode, string> = {
  lightning: "bg-warm",
  reasoning: "bg-cyan",
  deep: "bg-rose",
};

const modeHex: Record<ResearchMode, string> = {
  lightning: "#F97316",
  reasoning: "#06B6D4",
  deep: "#F43F5E",
};

const AUTO_SAVE_DELAY = 2000;

export default function EditorPage({
  params,
}: {
  params: Promise<{ projectId: string; docId: string }>;
}) {
  const { projectId, docId } = use(params);
  const { user } = useAuth();
  const project = useProjectsStore((s) => s.getProject(projectId));
  const fetchProjects = useProjectsStore((s) => s.fetchProjects);

  const [, setDocData] = useState<FirestoreDocument | null>(null);
  const [docLoading, setDocLoading] = useState(true);
  const [title, setTitle] = useState("Untitled Document");
  const [researchOpen, setResearchOpen] = useState(false);
  const [claimsOpen, setClaimsOpen] = useState(false);
  const [wordCount, setWordCount] = useState(0);
  const [citationCount, setCitationCount] = useState(0);
  const [showMenu, setShowMenu] = useState(false);
  const [saved, setSaved] = useState(true);
  const [editorHtml, setEditorHtml] = useState("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef("");
  const editorHandleRef = useRef<EditorHandle | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);

  // On-demand intra-document contradiction scan via Groq. Fires only
  // when the user clicks "Check" — never on debounce — so we don't
  // bill Groq on every keystroke.
  const {
    contradictions,
    scanning,
    lastScanAt,
    staleSinceLastScan,
    rescan: rescanContradictions,
  } = useDocContradictions({ editor });
  const hasScanned = lastScanAt != null;

  const handleJumpToContradiction = useCallback((text: string) => {
    editorHandleRef.current?.jumpToText(text);
  }, []);

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
    setClaimsOpen(false);
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
    setClaimsOpen(false);
    setCommentsOpen((v) => !v);
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
    setClaimsOpen(false);
    setResearchOpen((v) => !v);
  }, []);

  const openClaims = useCallback(() => {
    setResearchOpen(false);
    setClaimsOpen((v) => !v);
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
          setWordCount(doc.wordCount);
          setCitationCount(doc.citationCount);
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
  }, [docId]);

  const saveToFirestore = useCallback(
    async (content: string, words: number) => {
      try {
        await updateDocument(docId, { content, wordCount: words });
        setSaved(true);
      } catch (err) {
        console.error("Auto-save failed:", err);
      }
    },
    [docId]
  );

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
      updateDocument(docId, { title: newTitle })
        .then(() => setSaved(true))
        .catch(() => {});
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
  const ModeIcon = project ? modeIcons[project.mode] : Zap;
  const modeBg = project ? modeSolidBg[project.mode] : "bg-cyan";
  const hex = project ? modeHex[project.mode] : "#06B6D4";

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

      {/* Floating shape — subtle */}
      <motion.div
        className="fixed top-[12%] right-[3%] pointer-events-none"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
      >
        <div
          className="animate-float-drift"
          style={{ animationDuration: "10s" }}
        >
          <div
            className="w-5 h-5 border-[1.5px] opacity-25"
            style={{ transform: "rotate(45deg)", borderColor: hex }}
          />
        </div>
      </motion.div>

      {/* ── Top controls bar ── */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease }}
        className="relative z-20 h-12 flex items-center justify-between px-5 border-b border-border bg-background/80 backdrop-blur-md shrink-0"
      >
        {/* Left: breadcrumb */}
        <div className="flex items-center gap-2">
          <Link
            href={project ? `/project/${projectId}` : "/projects"}
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.2em] text-muted hover:text-violet transition-colors font-bold"
          >
            <ArrowLeft size={11} />
            <span className="max-w-[160px] truncate">
              {project?.name || "Dashboard"}
            </span>
          </Link>
          {project && (
            <>
              <span className="text-border">/</span>
              <Link
                href={`/project/${projectId}/graph`}
                className="flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] font-bold text-cyan border border-cyan/30 px-2 py-1 hover:bg-cyan/[0.1] transition-colors"
              >
                <Network size={9} />
                Graph
              </Link>
            </>
          )}
        </div>

        {/* Center: save status pill */}
        <AnimatePresence mode="wait">
          <motion.div
            key={saved ? "saved" : "saving"}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.2em] text-white px-2 py-0.5 tabular-nums ${
              saved ? "bg-green" : "bg-warm"
            }`}
          >
            <div
              className={`w-1.5 h-1.5 bg-white ${
                saved ? "" : "animate-pulse"
              }`}
            />
            {saved ? "Saved" : "Saving"}
          </motion.div>
        </AnimatePresence>

        {/* Right: actions */}
        <div className="flex items-center gap-1.5">
          {project && (
            <div
              className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.15em] text-white ${modeBg} px-2 py-1`}
            >
              <ModeIcon size={9} strokeWidth={2.5} />
              {modeLabels[project.mode]}
            </div>
          )}
          <button
            type="button"
            onClick={openClaims}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 transition-all duration-200 border text-[10px] font-bold uppercase tracking-[0.15em] ${
              claimsOpen
                ? "text-white bg-violet border-violet"
                : "text-violet border-violet/30 hover:bg-violet/[0.08]"
            }`}
            title="Claim check"
          >
            <Flag size={11} />
            <span className="hidden md:inline">Claims</span>
          </button>
          {/* Comment — primary action when there's a selection, panel
              toggle when there isn't. The icon dot turns violet when
              there are open (unresolved) comments. */}
          <button
            type="button"
            onClick={hasSelection ? startComment : openComments}
            className={`relative flex items-center gap-1.5 px-2.5 py-1.5 transition-all duration-200 border text-[10px] font-bold uppercase tracking-[0.15em] ${
              commentsOpen
                ? "text-white bg-violet border-violet"
                : "text-violet border-violet/30 hover:bg-violet/[0.08]"
            }`}
            title={hasSelection ? "Comment on selection" : "Open comments"}
          >
            <MessageSquare size={11} />
            <span className="hidden md:inline">
              {hasSelection ? "Comment" : "Comments"}
            </span>
            {commentsApi.comments.some((c) => !c.resolved) ? (
              <span className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-warm rounded-full" />
            ) : null}
          </button>
          {/* Check for contradictions — on-demand AI call */}
          <button
            type="button"
            onClick={() => void rescanContradictions()}
            disabled={scanning}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.15em] font-bold border text-warm border-warm/30 hover:bg-warm/[0.08] disabled:opacity-50 transition-all"
            title="Scan this document for contradicting statements"
          >
            <AlertTriangle size={11} />
            <span className="hidden md:inline">
              {scanning ? "Checking…" : "Check"}
            </span>
          </button>
          <ShareLinkButton documentId={docId} />
          <button
            type="button"
            onClick={openResearch}
            className={`p-2 transition-all duration-200 border ${
              researchOpen
                ? "text-white bg-cyan border-cyan"
                : "text-cyan border-cyan/30 hover:bg-cyan/[0.08]"
            }`}
            title="Research"
          >
            {researchOpen ? (
              <PanelRightClose size={13} />
            ) : (
              <PanelRightOpen size={13} />
            )}
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowMenu(!showMenu)}
              className="p-2 text-muted hover:text-foreground hover:bg-muted/10 border border-transparent hover:border-border transition-all"
            >
              <MoreHorizontal size={13} />
            </button>
            <AnimatePresence>
              {showMenu && (
                <>
                  <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowMenu(false)}
                  />
                  <motion.div
                    initial={{ opacity: 0, y: -6, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -6, scale: 0.96 }}
                    transition={{ duration: 0.14 }}
                    className="absolute right-0 top-full mt-1 w-48 bg-white dark:bg-surface border border-border shadow-[0_20px_40px_-12px_rgba(0,0,0,0.3)] overflow-hidden z-50"
                  >
                    {[
                      {
                        icon: Download,
                        label: "Export PDF",
                        color: "cyan",
                      },
                      { icon: Copy, label: "Duplicate", color: "violet" },
                      {
                        icon: Trash2,
                        label: "Delete",
                        color: "rose",
                        danger: true,
                      },
                    ].map((item) => {
                      const Icon = item.icon;
                      const danger = "danger" in item && item.danger;
                      return (
                        <button
                          key={item.label}
                          type="button"
                          onClick={() => setShowMenu(false)}
                          className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-[11px] uppercase tracking-[0.15em] font-bold border-l-2 border-l-transparent transition-colors ${
                            danger
                              ? "text-rose/80 hover:text-rose hover:bg-rose/[0.06] hover:border-l-rose"
                              : "text-muted hover:text-foreground hover:bg-muted/5 hover:border-l-violet"
                          }`}
                        >
                          <Icon size={12} />
                          {item.label}
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

          {/* Contradiction banner — only renders after the user clicks
              "Check" (the call into Groq is strictly on-demand). */}
          {scanning || hasScanned ? (
            <div className="mb-4">
              <ContradictionBanner
                contradictions={contradictions}
                scanning={scanning}
                staleSinceLastScan={staleSinceLastScan}
                hasScanned={hasScanned}
                onJump={handleJumpToContradiction}
                onRescan={() => void rescanContradictions()}
              />
            </div>
          ) : null}

          <ForgeEditor
            content={editorHtml}
            onUpdate={handleEditorUpdate}
            onWordCountChange={setWordCount}
            onReady={(handle) => {
              editorHandleRef.current = handle;
              setEditor(handle.editor);
            }}
          />
        </motion.div>

        {/* Side panels (mutually exclusive) with vivid accent border */}
        <div className="relative">
          {(researchOpen || claimsOpen) && (
            <div
              className="absolute top-0 left-0 bottom-0 w-[3px] bg-gradient-to-b from-violet via-cyan to-warm z-10"
              style={{ backgroundSize: "100% 300%" }}
            />
          )}
          <ResearchSidePanel
            open={researchOpen}
            onClose={() => setResearchOpen(false)}
            onInsertCitation={handleInsertCitation}
            projectId={projectId}
          />
          <ClaimCheckPanel
            open={claimsOpen}
            onClose={() => setClaimsOpen(false)}
            getEditorText={() => editorHandleRef.current?.getPlainText() ?? ""}
            onJumpToClaim={(text) => editorHandleRef.current?.jumpToText(text)}
            onInsertCitation={(c) => {
              handleInsertCitation({
                title: c.title,
                url: c.url,
                text: c.text,
                doi: c.doi,
              });
            }}
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

      {/* ── Bottom status bar ── */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease, delay: 0.15 }}
        className="relative z-20 shrink-0 h-9 flex items-center justify-between px-6 border-t border-border bg-white/70 dark:bg-surface/70 backdrop-blur-md"
      >
        <div className="flex items-center gap-1">
          <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-muted px-2.5 py-1 border-r border-border">
            <FileText size={9} className="text-cyan" />
            <span className="font-bold text-cyan tabular-nums">
              {wordCount.toLocaleString()}
            </span>
            words
          </span>
          <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-muted px-2.5 py-1 border-r border-border">
            <BookOpen size={9} className="text-warm" />
            <span className="font-bold text-warm tabular-nums">
              {readingTime}
            </span>
            min read
          </span>
          {citationCount > 0 && (
            <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.2em] text-muted px-2.5 py-1">
              <ShieldCheck size={9} className="text-green" />
              <span className="font-bold text-green tabular-nums">
                {citationCount}
              </span>
              cited
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] uppercase tracking-[0.25em] text-muted">
            ⁂ Forge Editor
          </span>
          <span className="w-1 h-1 bg-violet" />
          <span className="w-1 h-1 bg-cyan" />
          <span className="w-1 h-1 bg-warm" />
        </div>
      </motion.div>
    </div>
  );
}
