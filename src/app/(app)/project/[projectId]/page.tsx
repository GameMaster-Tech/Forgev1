"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  FileText,
  Plus,
  ArrowRight,
  Search,
  ShieldCheck,
  ArrowLeft,
  Zap,
  Brain,
  Microscope,
  Network,
  Loader2,
  X,
  ChevronDown,
  ChevronUp,
  Sparkles,
  AlertTriangle,
  ListChecks,
  Swords,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useProjectsStore, type ResearchMode } from "@/store/projects";
import { useAuth } from "@/context/AuthContext";
import {
  getProjectDocuments,
  createDocument,
  type FirestoreDocument,
} from "@/lib/firebase/firestore";

const ease = [0.22, 0.61, 0.36, 1] as const;

const modeConfig: Record<
  ResearchMode,
  {
    label: string;
    icon: typeof Zap;
    detail: string;
    pillClass: string;
  }
> = {
  lightning: {
    label: "Lightning",
    icon: Zap,
    detail: "3 sources · fast",
    pillClass: "text-warm bg-warm/10 border-warm/30",
  },
  reasoning: {
    label: "Reasoning",
    icon: Brain,
    detail: "5 sources · balanced",
    pillClass: "text-cyan bg-cyan/10 border-cyan/30",
  },
  deep: {
    label: "Deep research",
    icon: Microscope,
    detail: "10 sources · exhaustive",
    pillClass: "text-rose bg-rose/10 border-rose/30",
  },
};

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  return `${days}d ago`;
}

export default function ProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = use(params);
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const project = useProjectsStore((s) => s.getProject(projectId));
  const fetchProjects = useProjectsStore((s) => s.fetchProjects);
  const projectsLoading = useProjectsStore((s) => s.loading);
  const projectsLoaded = useProjectsStore((s) => s.loaded);
  const projectError = useProjectsStore((s) => s.error);
  const [showNewDoc, setShowNewDoc] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState("");
  const [showInstructions, setShowInstructions] = useState(false);
  const [docs, setDocs] = useState<FirestoreDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (user?.uid) fetchProjects(user.uid);
  }, [user?.uid, fetchProjects]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!user?.uid) {
        setDocsLoading(false);
        return;
      }
      setDocsLoading(true);
      setDocsError(null);
      try {
        const result = await getProjectDocuments(projectId, user.uid);
        if (!cancelled) setDocs(result);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Unable to load documents right now.";
        console.warn("Failed to load documents:", message);
        if (!cancelled) setDocsError(message);
      } finally {
        if (!cancelled) setDocsLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [projectId, user?.uid]);

  const handleCreateDoc = async () => {
    if (!newDocTitle.trim() || !user?.uid || creating) return;
    setCreating(true);
    try {
      const docId = await createDocument(
        user.uid,
        projectId,
        newDocTitle.trim()
      );
      setShowNewDoc(false);
      setNewDocTitle("");
      router.push(`/project/${projectId}/doc/${docId}`);
    } catch (err) {
      console.error("Failed to create document:", err);
    } finally {
      setCreating(false);
    }
  };

  if (
    !project &&
    (authLoading || projectsLoading || (user?.uid && !projectsLoaded && !projectError))
  ) {
    return (
      <div className="relative h-screen flex items-center justify-center bg-background">
        <div className="fixed inset-0 chromatic-bg pointer-events-none" />
        <div className="relative text-center max-w-sm border border-border bg-white/60 dark:bg-surface/60 backdrop-blur-sm px-10 py-9">
          <Loader2 size={20} className="text-violet animate-spin mx-auto mb-5" />
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet mb-2">
            Loading workspace
          </p>
          <p className="text-sm text-gray">Opening the selected project.</p>
        </div>
      </div>
    );
  }

  if (!project && projectError) {
    return (
      <div className="relative h-screen flex items-center justify-center bg-background">
        <div className="fixed inset-0 chromatic-bg pointer-events-none" />
        <div className="relative text-center max-w-md border border-border bg-white/60 dark:bg-surface/60 backdrop-blur-sm px-10 py-9">
          <div className="w-12 h-12 border border-border mx-auto mb-5 flex items-center justify-center bg-surface/60">
            <AlertTriangle size={18} className="text-warm" />
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-warm mb-2">
            Connection interrupted
          </p>
          <p className="font-display font-extrabold text-[28px] text-black dark:text-foreground mb-2 tracking-[-0.02em] leading-[1.05]">
            Workspace data is unavailable.
          </p>
          <p className="text-[13px] text-gray mb-6">{projectError}</p>
          <button
            onClick={() => user?.uid && fetchProjects(user.uid)}
            className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] font-bold text-white bg-violet px-4 py-2.5 transition-colors hover:bg-violet/90"
          >
            <Loader2 size={12} className={projectsLoading ? "animate-spin" : ""} />
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="relative h-screen flex items-center justify-center bg-background">
        <div className="fixed inset-0 pointer-events-none" />
        <div className="relative text-center max-w-sm">
          <div className="w-14 h-14 border border-border mx-auto mb-5 flex items-center justify-center bg-surface/60 backdrop-blur-sm">
            <Search size={20} className="text-muted" />
          </div>
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className="w-6 h-[2px] bg-violet" />
            <span className="text-[10px] font-bold text-violet uppercase tracking-[0.2em]">
              404 · Missing
            </span>
          </div>
          <p className="font-display font-extrabold text-[32px] text-black dark:text-foreground mb-2 tracking-[-0.02em] leading-[1.05]">
            Project not found
            <span className="bg-gradient-to-r from-violet to-cyan bg-clip-text text-transparent">.</span>
          </p>
          <p className="text-[13px] text-gray mb-6">
            This project may have been deleted or moved.
          </p>
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] font-bold text-white bg-violet px-4 py-2.5 transition-colors hover:bg-violet/90"
          >
            <ArrowLeft size={12} />
            Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const mc = modeConfig[project.mode];
  const totalCitations = docs.reduce((a, d) => a + d.citationCount, 0);
  const totalVerified = docs.reduce((a, d) => a + d.verifiedCount, 0);
  const verifiedPct =
    totalCitations > 0
      ? Math.round((totalVerified / totalCitations) * 100)
      : 0;

  return (
      <div className="min-h-screen bg-background overflow-y-auto relative">
      {/* Chromatic bg */}
      <div className="fixed inset-0 chromatic-bg pointer-events-none" />
      {/* Dot grid */}
      <div
        className="fixed inset-0 opacity-[0.03] dark:opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, var(--foreground) 0.5px, transparent 0)",
          backgroundSize: "32px 32px",
        }}
      />
      {/* Floating shapes */}



      {/* ── Nav bar ── */}
      <motion.nav
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.25, ease }}
        className="relative z-20 sticky top-0 h-12 flex items-center justify-between px-6 border-b border-border bg-background/80 backdrop-blur-md"
      >
        <Link
          href="/projects"
          className="text-[11px] uppercase tracking-[0.15em] text-muted hover:text-violet font-bold transition-colors flex items-center gap-2"
        >
          <ArrowLeft size={12} />
          Dashboard
        </Link>
        <div className="flex items-center gap-2">
          <Link
            href={`/project/${projectId}/planner`}
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted hover:text-foreground font-bold border border-border hover:border-foreground/20 px-3 py-1.5 transition-colors"
          >
            <ListChecks size={11} />
            Planner
          </Link>
          <Link
            href={`/project/${projectId}/counterforge`}
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted hover:text-rose font-bold border border-border hover:border-rose/30 px-3 py-1.5 transition-colors"
          >
            <Swords size={11} />
            Counterforge
          </Link>
          <Link
            href={`/project/${projectId}/graph`}
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-muted hover:text-foreground font-bold border border-border hover:border-foreground/20 px-3 py-1.5 transition-colors"
          >
            <Network size={11} />
            Graph
          </Link>
          <button
            onClick={() => setShowNewDoc(true)}
            className="group relative flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-white bg-violet hover:bg-violet/90 px-3 py-1.5 font-bold transition-colors overflow-hidden"
          >
            <Plus size={11} strokeWidth={2.5} className="relative" />
            <span className="relative">New doc</span>
          </button>
        </div>
      </motion.nav>

      {/* ══════════════════════════════════════════════
         HERO HEADER
         ══════════════════════════════════════════════ */}
      <div className="relative z-10 overflow-hidden header-gradient">
        <div className="relative max-w-6xl mx-auto px-8 pt-12 pb-10">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, ease }}
            className="flex items-center gap-3 mb-5 flex-wrap"
          >
            <div className="w-8 h-[2px] bg-violet" />
            <span className="text-[11px] font-semibold text-violet uppercase tracking-[0.2em]">
              Workspace
            </span>
            <span className="text-[10px] text-muted">·</span>
            <span
              className={`text-[10px] font-bold uppercase tracking-[0.12em] inline-flex items-center gap-1.5 px-2 py-0.5 border ${mc.pillClass}`}
            >
              <mc.icon size={10} strokeWidth={2} />
              {mc.label}
            </span>
            <span className="text-[10px] text-muted">·</span>
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
              {mc.detail}
            </span>
          </motion.div>

          <div className="flex items-end justify-between gap-6 flex-wrap mb-8">
            <div className="flex-1 min-w-[280px]">
              <motion.h1
                initial={{ opacity: 0, y: 30, rotateX: -15 }}
                animate={{ opacity: 1, y: 0, rotateX: 0 }}
                transition={{ duration: 0.6, ease }}
                className="font-display font-extrabold text-black dark:text-foreground tracking-[-0.03em] leading-[1.02]"
                style={{ fontSize: "clamp(2.4rem, 5vw, 3.8rem)" }}
              >
                {project.name}
                <span className="bg-gradient-to-r from-violet to-cyan bg-clip-text text-transparent">.</span>
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease, delay: 0.1 }}
                className="text-base text-gray mt-2"
              >
                {docs.length} document{docs.length === 1 ? "" : "s"} · {totalCitations} citation{totalCitations === 1 ? "" : "s"} · {verifiedPct}% verified
              </motion.p>
            </div>

            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease, delay: 0.18 }}
              onClick={() => setShowNewDoc(true)}
              className="group flex items-center gap-2.5 px-5 py-3 bg-black dark:bg-white text-white dark:text-black hover:bg-violet dark:hover:bg-violet dark:hover:text-white transition-all duration-200 relative overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-violet via-blue to-cyan opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
              <Plus size={15} strokeWidth={2.5} className="relative" />
              <span className="relative text-[12px] font-bold uppercase tracking-[0.12em]">
                New Document
              </span>
            </motion.button>
          </div>

          {/* ── Stats row ── */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease, delay: 0.24 }}
            className="mt-8 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-foreground/[0.06] pt-6 text-[12px] text-muted"
          >
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.18em] text-foreground/45">
                Mode
              </span>
              <span className="font-bold text-foreground">{mc.label}</span>
              <span className="text-foreground/55">— {mc.detail}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.18em] text-foreground/45">
                Documents
              </span>
              <span className="font-bold tabular-nums text-foreground">
                {docsLoading ? "…" : docs.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.18em] text-foreground/45">
                Citations
              </span>
              <span className="font-bold tabular-nums text-foreground">
                {totalCitations}
              </span>
            </div>
            {totalCitations > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-[10px] uppercase tracking-[0.18em] text-foreground/45">
                  Verified
                </span>
                <span className="font-bold tabular-nums text-violet">
                  {verifiedPct}%
                </span>
              </div>
            )}
            {docsError && (
              <span className="text-rose">Error loading documents</span>
            )}
          </motion.div>

          {/* Instructions toggle */}
          {project.systemInstructions && (
            <div className="mt-6">
              <button
                onClick={() => setShowInstructions(!showInstructions)}
                className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted hover:text-violet font-bold transition-colors"
              >
                {showInstructions ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                System instructions
              </button>
              <AnimatePresence>
                {showInstructions && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.22, ease }}
                    className="overflow-hidden"
                  >
                    <div className="mt-3 px-4 py-3 bg-white/60 dark:bg-surface/60 backdrop-blur-sm border border-border border-l-[2px] border-l-violet">
                      <p className="text-[13px] text-muted leading-relaxed">
                        {project.systemInstructions}
                      </p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

      </div>

      {/* ══════════════════════════════════════════════
         DOCUMENTS
         ══════════════════════════════════════════════ */}
      <div className="relative z-10 max-w-6xl mx-auto px-8 py-12">
        {/* Inline new doc bar */}
        <AnimatePresence>
          {showNewDoc && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.22, ease }}
              className="overflow-hidden mb-6"
            >
              <div className="flex items-center gap-3 px-5 py-3.5 bg-white/70 dark:bg-surface/70 backdrop-blur-sm border border-border border-l-4 border-l-violet">
                <div className="w-9 h-9 bg-gradient-to-br from-violet to-cyan flex items-center justify-center shrink-0 shadow-[0_4px_16px_-4px_rgba(37,99,235,0.5)]">
                  <FileText size={14} className="text-white" />
                </div>
                <input
                  type="text"
                  value={newDocTitle}
                  onChange={(e) => setNewDocTitle(e.target.value)}
                  placeholder="Document title"
                  autoFocus
                  className="flex-1 bg-transparent text-[14px] text-foreground placeholder:text-muted focus:outline-none font-medium"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setShowNewDoc(false);
                      setNewDocTitle("");
                    }
                    if (e.key === "Enter") handleCreateDoc();
                  }}
                />
                <button
                  onClick={handleCreateDoc}
                  disabled={creating || !newDocTitle.trim()}
                  className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] font-bold text-white bg-violet hover:bg-violet/90 px-4 py-2 transition-all disabled:opacity-40"
                >
                  {creating ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <>
                      Create
                      <ArrowRight size={12} />
                    </>
                  )}
                </button>
                <button
                  onClick={() => {
                    setShowNewDoc(false);
                    setNewDocTitle("");
                  }}
                  className="p-1.5 text-muted hover:text-foreground transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, ease, delay: 0.3 }}
        >
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="w-8 h-[2px] bg-violet" />
              <span className="text-[11px] font-semibold text-violet uppercase tracking-[0.2em]">
                Documents
              </span>
            </div>
            <span className="text-[10px] font-semibold text-violet bg-violet/15 border border-violet/30 px-2.5 py-1">
              {docs.length}
            </span>
          </div>

          {docsLoading ? (
            <div className="flex items-center gap-3 py-20 justify-center text-sm text-muted border border-border bg-white/50 dark:bg-surface/50 backdrop-blur-sm">
              <Loader2 size={16} className="animate-spin text-violet" />
              Loading documents...
            </div>
          ) : docs.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease }}
              className="relative border border-border bg-white/60 dark:bg-surface/60 backdrop-blur-sm overflow-hidden"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-violet/[0.06] via-transparent to-cyan/[0.05] pointer-events-none" />
              <div className="relative grid md:grid-cols-[1fr_1.2fr] gap-0">
                <div className="px-10 py-14">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-6 h-[2px] bg-violet" />
                    <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-violet">
                      Empty shelf
                    </span>
                  </div>
                  <h3 className="font-display font-extrabold text-3xl text-black dark:text-foreground leading-[1.05] tracking-[-0.02em] mb-3">
                    Start your first<br />research doc.
                  </h3>
                  <p className="text-sm text-gray leading-relaxed mb-6 max-w-sm">
                    Documents are where research meets writing. Ask, cite,
                    verify — every fact traceable to a source.
                  </p>
                  <button
                    onClick={() => setShowNewDoc(true)}
                    className="group inline-flex items-center gap-2 px-4 py-2.5 bg-violet text-white text-[11px] font-bold uppercase tracking-[0.12em] hover:bg-violet/90 transition-colors"
                  >
                    <Plus size={13} strokeWidth={2.5} />
                    Create document
                    <ArrowRight
                      size={13}
                      className="group-hover:translate-x-1 transition-transform"
                    />
                  </button>
                </div>
                <div className="relative border-l border-border bg-background/30 px-8 py-10 flex flex-col justify-center gap-4">
                  <EmptyFeature
                    n="01"
                    color="violet"
                    title="Ask with context"
                    body="Type a question. Forge pulls from 200M+ indexed sources."
                  />
                  <EmptyFeature
                    n="02"
                    color="cyan"
                    title="Cite as you write"
                    body="Inline citations with DOI-verified provenance."
                  />
                  <EmptyFeature
                    n="03"
                    color="warm"
                    title="Verify instantly"
                    body="Every claim checked against its source. Nothing hallucinated."
                  />
                </div>
              </div>
            </motion.div>
          ) : (
            <div className="space-y-0">
              {docs.map((doc, i) => {
                const verifyPct =
                  doc.citationCount > 0
                    ? Math.round((doc.verifiedCount / doc.citationCount) * 100)
                    : 0;
                const isVerified = verifyPct === 100 && doc.citationCount > 0;
                return (
                  <motion.div
                    key={doc.id}
                    initial={{ opacity: 0, x: -20, rotateY: -3 }}
                    animate={{ opacity: 1, x: 0, rotateY: 0 }}
                    transition={{ duration: 0.4, ease, delay: 0.34 + i * 0.05 }}
                  >
                    <Link
                      href={`/project/${projectId}/doc/${doc.id}`}
                      className="group relative flex items-center gap-6 px-6 py-5 bg-white/70 dark:bg-surface/70 backdrop-blur-sm border border-border border-l-4 border-l-violet hover:bg-violet/[0.06] hover:border-violet/30 transition-all duration-200 -mt-px hover:translate-x-1"
                    >
                      {/* Index + ID */}
                      <div className="flex flex-col items-start gap-1.5 shrink-0 w-[80px]">
                        <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white bg-violet px-2 py-0.5">
                          Doc {String(i + 1).padStart(2, "0")}
                        </span>
                        <span className="text-[9px] text-muted font-mono">
                          D-{doc.id.slice(-4).toUpperCase()}
                        </span>
                      </div>

                      {/* Monogram */}
                      <div className="w-12 h-12 bg-gradient-to-br from-violet to-cyan flex items-center justify-center text-white font-display font-black text-lg shrink-0 shadow-[0_4px_16px_-4px_rgba(37,99,235,0.5)]">
                        <FileText size={18} strokeWidth={2.25} />
                      </div>

                      {/* Title + meta */}
                      <div className="flex-1 min-w-0">
                        <div className="font-display font-bold text-[17px] text-black dark:text-foreground truncate group-hover:text-violet transition-colors tracking-[-0.01em]">
                          {doc.title}
                        </div>
                        <div
                          className="text-[12px] text-gray truncate mt-0.5 flex items-center gap-2"
                          suppressHydrationWarning
                        >
                          <span>
                            {timeAgo(doc.updatedAt?.toMillis?.() ?? Date.now())}
                          </span>
                          {isVerified && (
                            <>
                              <span className="text-border">·</span>
                              <span className="text-green inline-flex items-center gap-1">
                                <ShieldCheck size={10} />
                                Fully verified
                              </span>
                            </>
                          )}
                        </div>
                      </div>

                      {/* Stats */}
                      <div className="hidden md:flex items-center gap-8 shrink-0 pr-2">
                        <StatTick
                          label="Words"
                          value={
                            doc.wordCount > 999
                              ? `${(doc.wordCount / 1000).toFixed(1)}k`
                              : String(doc.wordCount)
                          }
                          color="cyan"
                        />
                        <StatTick
                          label="Cites"
                          value={String(doc.citationCount)}
                          color="warm"
                        />
                      </div>

                      <ArrowRight
                        size={14}
                        className="text-muted group-hover:text-violet group-hover:translate-x-1.5 transition-all shrink-0"
                      />
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          )}
        </motion.div>

        {/* Footer hint */}
        {docs.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, ease, delay: 0.6 }}
            className="mt-10 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted font-bold"
          >
            <Sparkles size={11} className="text-violet" />
            <span>End of documents · {docs.length} total</span>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/* ─ StatCell for hero stats row ─ */
function StatCell({
  label,
  value,
  accent,
  Icon,
  last = false,
}: {
  label: string;
  value: number | string;
  accent: "violet" | "cyan" | "warm" | "rose";
  Icon: typeof FileText;
  last?: boolean;
}) {
  const accentMap: Record<string, { text: string; bg: string }> = {
    violet: { text: "text-violet", bg: "bg-violet" },
    cyan: { text: "text-cyan", bg: "bg-cyan" },
    warm: { text: "text-warm", bg: "bg-warm" },
    rose: { text: "text-rose", bg: "bg-rose" },
  };
  const a = accentMap[accent];
  return (
    <div
      className={`relative px-5 py-5 md:py-6 border-border ${
        last ? "" : "border-r border-b md:border-b-0"
      } group hover:bg-white/60 dark:hover:bg-surface/80 transition-colors`}
    >
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-1.5 h-1.5 ${a.bg}`} />
        <span
          className={`text-[9px] font-bold uppercase tracking-[0.2em] ${a.text}`}
        >
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-2">
        <span
          className="font-display font-extrabold text-[34px] leading-none text-black dark:text-foreground tracking-[-0.02em] tabular-nums"
        >
          {value}
        </span>
        <Icon size={13} className="text-muted opacity-60" />
      </div>
    </div>
  );
}

function StatTick({
  label,
  value,
}: {
  label: string;
  value: string;
  color: "cyan" | "warm";
}) {
  return (
    <div className="text-right">
      <div
        className="font-display font-bold text-lg leading-none tabular-nums text-black dark:text-foreground"
      >
        {value}
      </div>
      <div className="text-[9px] uppercase tracking-[0.15em] text-muted font-bold mt-1">
        {label}
      </div>
    </div>
  );
}

function EmptyFeature({
  n,
  color,
  title,
  body,
}: {
  n: string;
  color: "violet" | "cyan" | "warm";
  title: string;
  body: string;
}) {
  const map = {
    violet: "text-violet",
    cyan: "text-cyan",
    warm: "text-warm",
  } as const;
  return (
    <div className="flex items-start gap-4">
      <span
        className={`font-display font-black text-2xl leading-none ${map[color]} tracking-tight shrink-0 w-10`}
      >
        {n}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-bold text-black dark:text-foreground">
          {title}
        </div>
        <div className="text-[11px] text-gray leading-relaxed mt-0.5">
          {body}
        </div>
      </div>
    </div>
  );
}
