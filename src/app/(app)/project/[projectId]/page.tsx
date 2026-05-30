"use client";

/**
 * Project — workspace home.
 *
 * Matches the rest of the Forge UI scheme (teams / projects / calendar):
 * standard motion.header with eyebrow + h1 + subtitle + primary CTA,
 * 8/4 main+rail body. Main column hosts the document list; the rail
 * carries the project meta (mode, system instructions, planner /
 * graph links). No gradient hero, no chromatic backgrounds.
 */

import { use, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Brain,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  FileText,
  ListChecks,
  Loader2,
  Microscope,
  Network,
  Plus,
  Sparkles,
  X,
  Zap,
  AlertTriangle,
  Search,
} from "lucide-react";
import { useProjectsStore, type ResearchMode } from "@/store/projects";
import { useAuth } from "@/context/AuthContext";
import {
  createDocument,
  getProjectDocuments,
  type FirestoreDocument,
} from "@/lib/firebase/firestore";
import { CrystallizeModal } from "@/components/crystallize/CrystallizeModal";
import { ProjectActionsMenu } from "@/components/app/ProjectActionsMenu";
import { DocActionsMenu } from "@/components/app/DocActionsMenu";

const ease = [0.22, 0.61, 0.36, 1] as const;

const modeConfig: Record<
  ResearchMode,
  { label: string; icon: typeof Zap; detail: string; tone: string }
> = {
  lightning: {
    label: "Lightning",
    icon: Zap,
    detail: "Fast, 3 sources",
    tone: "text-warm",
  },
  reasoning: {
    label: "Reasoning",
    icon: Brain,
    detail: "Balanced, 5 sources",
    tone: "text-cyan",
  },
  deep: {
    label: "Deep",
    icon: Microscope,
    detail: "Exhaustive, 10+ sources",
    tone: "text-rose",
  },
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  const w = Math.floor(d / 7);
  return `${w}w`;
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

  const [docs, setDocs] = useState<FirestoreDocument[]>([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [showNewDoc, setShowNewDoc] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showCrystallize, setShowCrystallize] = useState(false);

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
          err instanceof Error ? err.message : "Couldn't load documents.";
        console.warn("Failed to load documents:", message);
        if (!cancelled) setDocsError(message);
      } finally {
        if (!cancelled) setDocsLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [projectId, user?.uid]);

  const reloadDocs = async () => {
    if (!user?.uid) return;
    try {
      const result = await getProjectDocuments(projectId, user.uid);
      setDocs(result);
    } catch {
      /* best effort — the row already updated optimistically */
    }
  };

  const handleCreateDoc = async () => {
    if (!newDocTitle.trim() || !user?.uid || creating) return;
    setCreating(true);
    try {
      const docId = await createDocument(user.uid, projectId, newDocTitle.trim());
      setShowNewDoc(false);
      setNewDocTitle("");
      router.push(`/project/${projectId}/doc/${docId}`);
    } catch (err) {
      console.error("Failed to create document:", err);
    } finally {
      setCreating(false);
    }
  };

  const sortedDocs = useMemo(
    () =>
      [...docs].sort(
        (a, b) =>
          (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0),
      ),
    [docs],
  );

  // Group docs into a parent→children tree so sub-pages render
  // nested under their parent. Anything whose parentId points at a
  // doc that doesn't exist (e.g. parent was deleted) is treated as
  // top-level so we never lose data behind a broken edge.
  const tree = useMemo(() => {
    const childrenOf = new Map<string, FirestoreDocument[]>();
    const known = new Set(sortedDocs.map((d) => d.id));
    const roots: FirestoreDocument[] = [];
    for (const d of sortedDocs) {
      const parent = d.parentId && known.has(d.parentId) ? d.parentId : null;
      if (parent) {
        const arr = childrenOf.get(parent);
        if (arr) arr.push(d);
        else childrenOf.set(parent, [d]);
      } else {
        roots.push(d);
      }
    }
    return { roots, childrenOf };
  }, [sortedDocs]);

  /* ───── loading / error / not-found states ───── */

  if (
    !project &&
    (authLoading ||
      projectsLoading ||
      (user?.uid && !projectsLoaded && !projectError))
  ) {
    return (
      <div className="min-h-full bg-background flex items-center justify-center">
        <div className="text-center max-w-sm border border-border bg-surface px-10 py-9">
          <Loader2
            size={18}
            className="text-violet animate-spin mx-auto mb-4"
          />
          <p className="text-[10px] uppercase tracking-[0.18em] text-violet font-semibold mb-2">
            Opening
          </p>
          <p className="text-[13px] text-muted">Loading your project…</p>
        </div>
      </div>
    );
  }

  if (!project && projectError) {
    return (
      <div className="min-h-full bg-background flex items-center justify-center">
        <div className="text-center max-w-md border border-border bg-surface px-10 py-9">
          <div className="w-10 h-10 border border-border bg-background mx-auto mb-4 flex items-center justify-center">
            <AlertTriangle size={16} className="text-warm" />
          </div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-warm font-semibold mb-2">
            Can&apos;t reach Firebase
          </p>
          <h2 className="font-display font-bold text-foreground text-2xl tracking-[-0.022em] mb-2">
            Project unavailable.
          </h2>
          <p className="text-[13px] text-muted mb-5">{projectError}</p>
          <button
            onClick={() => user?.uid && fetchProjects(user.uid)}
            className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] font-semibold text-white bg-violet hover:bg-violet/90 px-4 py-2 transition-colors"
          >
            <Loader2
              size={12}
              className={projectsLoading ? "animate-spin" : ""}
            />
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-full bg-background flex items-center justify-center">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 border border-border bg-surface mx-auto mb-4 flex items-center justify-center">
            <Search size={16} className="text-muted" />
          </div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold mb-2">
            Not found
          </p>
          <h2 className="font-display font-bold text-foreground text-2xl tracking-[-0.022em] mb-2">
            Project not found.
          </h2>
          <p className="text-[13px] text-muted mb-5">
            It may have been deleted or moved.
          </p>
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] font-semibold text-white bg-violet hover:bg-violet/90 px-4 py-2 transition-colors"
          >
            <ArrowLeft size={12} />
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  const mc = modeConfig[project.mode];

  return (
    <div className="min-h-full bg-background">
      {/* ─── Header ─── */}
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="border-b border-border px-6 sm:px-10 pt-10 pb-6"
      >
        <Link
          href="/projects"
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] font-medium text-muted hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft size={11} strokeWidth={2} />
          Projects
        </Link>
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-2 flex items-center gap-2">
              <mc.icon
                size={11}
                strokeWidth={1.75}
                className={mc.tone}
              />
              {mc.label} · {mc.detail}
            </p>
            <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
              {project.name}
            </h1>
            <p className="text-[13px] text-muted mt-2 max-w-xl leading-relaxed">
              {docs.length} document{docs.length === 1 ? "" : "s"}
              {docs.length > 0
                ? `, ${docs.reduce((a, d) => a + d.citationCount, 0)} citation${
                    docs.reduce((a, d) => a + d.citationCount, 0) === 1
                      ? ""
                      : "s"
                  }`
                : ""}
              .
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setShowCrystallize(true)}
              disabled={docs.length < 2}
              title={
                docs.length < 2
                  ? "Need at least 2 docs to crystallize"
                  : "Synthesize 2–5 docs into a new brief"
              }
              className="inline-flex items-center gap-1.5 border border-violet/40 text-violet hover:bg-violet/[0.08] disabled:opacity-50 disabled:cursor-not-allowed text-[11px] font-semibold uppercase tracking-[0.14em] px-3 py-2 transition-colors"
            >
              <Sparkles size={12} strokeWidth={2.25} />
              Crystallize
            </button>
            <button
              onClick={() => setShowNewDoc(true)}
              className="inline-flex items-center gap-1.5 bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.14em] px-3.5 py-2 transition-colors"
            >
              <Plus size={12} strokeWidth={2.25} />
              New document
            </button>
            <div className="border border-border">
              <ProjectActionsMenu
                project={project}
                onChanged={() => {
                  if (user?.uid) void getProjectDocuments(projectId, user.uid).then(setDocs).catch(() => {});
                }}
              />
            </div>
          </div>
        </div>
      </motion.header>

      {/* ─── Body ─── */}
      <div className="grid grid-cols-12 gap-x-0">
        {/* Main column */}
        <div className="col-span-12 lg:col-span-8 px-6 sm:px-10 pt-8 pb-16 lg:border-r lg:border-border">
          {/* Inline new-doc bar */}
          <AnimatePresence>
            {showNewDoc ? (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.22, ease }}
                className="overflow-hidden mb-5"
              >
                <div className="flex items-center gap-3 px-4 py-3 bg-surface border border-border">
                  <FileText size={14} className="text-violet shrink-0" />
                  <input
                    type="text"
                    value={newDocTitle}
                    onChange={(e) => setNewDocTitle(e.target.value)}
                    placeholder="Document title"
                    autoFocus
                    className="flex-1 bg-transparent text-[14px] text-foreground placeholder:text-muted focus:outline-none"
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setShowNewDoc(false);
                        setNewDocTitle("");
                      }
                      if (e.key === "Enter") void handleCreateDoc();
                    }}
                  />
                  <button
                    onClick={handleCreateDoc}
                    disabled={creating || !newDocTitle.trim()}
                    className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] font-semibold text-white bg-violet hover:bg-violet/90 px-3 py-2 transition-colors disabled:opacity-40"
                  >
                    {creating ? (
                      <Loader2 size={11} className="animate-spin" />
                    ) : (
                      <>
                        Create
                        <ArrowRight size={11} />
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
                    <X size={13} />
                  </button>
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>

          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium">
              Documents
            </p>
            {docs.length > 0 ? (
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
                {docs.length} total
              </span>
            ) : null}
          </div>

          {docsLoading ? (
            <div className="flex items-center gap-3 py-16 justify-center text-[13px] text-muted border border-border bg-surface">
              <Loader2 size={14} className="animate-spin text-violet" />
              Loading documents…
            </div>
          ) : docsError ? (
            <div className="border border-rose/40 bg-rose/[0.06] text-rose text-[12px] px-4 py-3">
              {docsError}
            </div>
          ) : sortedDocs.length === 0 ? (
            <EmptyDocuments onCreate={() => setShowNewDoc(true)} />
          ) : (
            <ul className="divide-y divide-border border border-border bg-surface">
              {tree.roots.map((doc, i) => (
                <DocumentTreeRow
                  key={doc.id}
                  doc={doc}
                  childrenOf={tree.childrenOf}
                  projectId={projectId}
                  depth={0}
                  order={i}
                  onChanged={reloadDocs}
                  onAddSubPage={async (parentId, title) => {
                    if (!user?.uid) return;
                    setCreating(true);
                    try {
                      const newId = await createDocument(
                        user.uid,
                        projectId,
                        title.trim() || "Untitled",
                        parentId,
                      );
                      router.push(`/project/${projectId}/doc/${newId}`);
                    } finally {
                      setCreating(false);
                    }
                  }}
                />
              ))}
            </ul>
          )}
        </div>

        {/* Right rail */}
        <aside className="col-span-12 lg:col-span-4 px-6 sm:px-10 pt-8 pb-16 space-y-6">
          <ProjectMetaCard
            mode={mc}
            createdAt={project.createdAt}
            updatedAt={project.updatedAt}
          />
          {project.systemInstructions ? (
            <SystemInstructionsCard
              text={project.systemInstructions}
              open={showInstructions}
              onToggle={() => setShowInstructions((v) => !v)}
            />
          ) : null}
          <ToolsCard projectId={projectId} />
        </aside>
      </div>

      {/* Crystallize — cross-doc synthesis modal. Mounted at root
          so its focus trap + backdrop sit above all page content. */}
      <CrystallizeModal
        open={showCrystallize}
        onClose={() => setShowCrystallize(false)}
        projectId={projectId}
        docs={docs}
      />
    </div>
  );
}

/* ────── tree row (recursive) ────── */

function DocumentTreeRow({
  doc,
  childrenOf,
  projectId,
  depth,
  order,
  onAddSubPage,
  onChanged,
}: {
  doc: FirestoreDocument;
  childrenOf: Map<string, FirestoreDocument[]>;
  projectId: string;
  depth: number;
  order: number;
  onAddSubPage: (parentId: string, title: string) => Promise<void>;
  onChanged: () => void;
}) {
  const verifyPct =
    doc.citationCount > 0
      ? Math.round((doc.verifiedCount / doc.citationCount) * 100)
      : 0;
  const updatedAt = doc.updatedAt?.toMillis?.() ?? Date.now();
  const children = childrenOf.get(doc.id) ?? [];
  const [expanded, setExpanded] = useState(true);
  const [addingChild, setAddingChild] = useState(false);
  const [childTitle, setChildTitle] = useState("");
  const [submittingChild, setSubmittingChild] = useState(false);

  const submitChild = async () => {
    if (!childTitle.trim() || submittingChild) return;
    setSubmittingChild(true);
    try {
      await onAddSubPage(doc.id, childTitle);
      setChildTitle("");
      setAddingChild(false);
    } finally {
      setSubmittingChild(false);
    }
  };

  // Indent step: 24px per depth — readable without overwhelming.
  const indent = depth * 24;
  return (
    <motion.li
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.28, delay: Math.min(order, 12) * 0.04, ease }}
    >
      <div className="group relative flex items-center gap-3 pl-5 pr-5 py-3 hover:bg-violet/[0.06] transition-colors duration-150">
        <span
          aria-hidden
          className="absolute left-0 top-3 bottom-3 w-[2px] bg-border group-hover:bg-violet transition-colors duration-150"
        />
        {/* Expander — only renders when the row has children. */}
        <div
          style={{ width: indent }}
          aria-hidden
          className="shrink-0"
        />
        {children.length > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              setExpanded((v) => !v);
            }}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="text-muted hover:text-violet transition-colors p-1 -ml-1"
          >
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </button>
        ) : (
          <span className="w-5" aria-hidden />
        )}
        <Link
          href={`/project/${projectId}/doc/${doc.id}`}
          className="flex items-center gap-4 flex-1 min-w-0"
        >
          <div className="w-8 h-8 border border-border bg-background flex items-center justify-center shrink-0 group-hover:border-violet/40 transition-colors">
            <FileText
              size={13}
              strokeWidth={1.75}
              className="text-muted group-hover:text-violet transition-colors"
            />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold text-[14.5px] sm:text-[15.5px] text-foreground truncate group-hover:text-violet transition-colors tracking-[-0.01em]">
              {doc.title}
            </div>
            <div className="text-[11px] text-muted mt-0.5 tabular-nums flex items-center gap-2">
              <span suppressHydrationWarning>{timeAgo(updatedAt)}</span>
              {doc.wordCount > 0 ? (
                <>
                  <span className="text-border">·</span>
                  <span>{doc.wordCount} words</span>
                </>
              ) : null}
              {doc.citationCount > 0 ? (
                <>
                  <span className="text-border">·</span>
                  <span>
                    {doc.citationCount} citation{doc.citationCount === 1 ? "" : "s"}
                    {verifyPct === 100 ? (
                      <span className="text-green"> · verified</span>
                    ) : null}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </Link>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            setAddingChild(true);
            setExpanded(true);
          }}
          aria-label="Add sub-page"
          title="Add sub-page"
          className="text-muted opacity-0 group-hover:opacity-100 hover:text-violet transition-all p-1"
        >
          <Plus size={12} strokeWidth={2.25} />
        </button>
        <DocActionsMenu docId={doc.id} projectId={projectId} onChanged={onChanged} />
        <ArrowRight
          size={13}
          className="text-muted group-hover:text-violet transition-colors shrink-0"
        />
      </div>

      {/* Inline new sub-page input */}
      {addingChild ? (
        <div
          className="flex items-center gap-2 pr-5 py-2 bg-surface/60 border-t border-border"
          style={{ paddingLeft: 20 + indent + 24 + 16 }}
        >
          <FileText size={12} className="text-violet shrink-0" />
          <input
            type="text"
            value={childTitle}
            onChange={(e) => setChildTitle(e.target.value)}
            placeholder="Sub-page title"
            autoFocus
            className="flex-1 bg-transparent text-[13px] text-foreground placeholder:text-muted focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setAddingChild(false);
                setChildTitle("");
              }
              if (e.key === "Enter") void submitChild();
            }}
          />
          <button
            type="button"
            onClick={submitChild}
            disabled={!childTitle.trim() || submittingChild}
            className="text-[10px] uppercase tracking-[0.12em] font-semibold text-white bg-violet hover:bg-violet/90 disabled:opacity-40 px-3 py-1.5 transition-colors"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => {
              setAddingChild(false);
              setChildTitle("");
            }}
            aria-label="Cancel"
            className="text-muted hover:text-foreground p-1"
          >
            <X size={11} />
          </button>
        </div>
      ) : null}

      {expanded && children.length > 0 ? (
        <ul className="border-t border-border">
          {children.map((c, i) => (
            <DocumentTreeRow
              key={c.id}
              doc={c}
              childrenOf={childrenOf}
              projectId={projectId}
              depth={depth + 1}
              order={i}
              onAddSubPage={onAddSubPage}
              onChanged={onChanged}
            />
          ))}
        </ul>
      ) : null}
    </motion.li>
  );
}

/* ────── empty state ────── */

function EmptyDocuments({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="border border-dashed border-border bg-surface/40 p-10 text-center">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-medium mb-2">
        No documents yet
      </p>
      <h3 className="font-display font-bold text-foreground text-[20px] tracking-[-0.018em] mb-2">
        Start your first one.
      </h3>
      <p className="text-[12.5px] text-muted leading-relaxed max-w-sm mx-auto mb-5">
        Ask, cite, and write — every fact stays traceable to a source.
      </p>
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] font-semibold text-white bg-violet hover:bg-violet/90 px-4 py-2 transition-colors"
      >
        <Plus size={12} strokeWidth={2.25} />
        Create document
      </button>
    </div>
  );
}

/* ────── right rail cards ────── */

function ProjectMetaCard({
  mode,
  createdAt,
  updatedAt,
}: {
  mode: { label: string; icon: typeof Zap; detail: string; tone: string };
  createdAt: number;
  updatedAt: number;
}) {
  return (
    <div className="border border-border bg-surface p-5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        Project
      </p>
      <div className="space-y-2 text-[12px] text-foreground tabular-nums">
        <Row label="Mode" value={`${mode.label} — ${mode.detail}`} />
        <Row label="Created" value={new Date(createdAt).toLocaleDateString()} />
        <Row label="Last edit" value={timeAgo(updatedAt) + " ago"} />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] uppercase tracking-[0.14em] text-muted font-medium">
        {label}
      </span>
      <span className="text-foreground/85 text-[12px] truncate text-right">
        {value}
      </span>
    </div>
  );
}

function SystemInstructionsCard({
  text,
  open,
  onToggle,
}: {
  text: string;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border border-border bg-surface">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-5 py-3 hover:bg-violet/[0.04] transition-colors"
      >
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium">
          AI instructions
        </span>
        {open ? (
          <ChevronUp size={12} className="text-muted" />
        ) : (
          <ChevronDown size={12} className="text-muted" />
        )}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease }}
            className="overflow-hidden"
          >
            <div className="px-5 py-3 border-t border-border">
              <p className="text-[12.5px] text-foreground leading-relaxed whitespace-pre-wrap">
                {text}
              </p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function ToolsCard({ projectId }: { projectId: string }) {
  const tools = [
    {
      icon: ListChecks,
      label: "Planner",
      hint: "What's left to research",
      href: `/project/${projectId}/planner`,
    },
    {
      icon: Network,
      label: "Graph",
      hint: "See how sources connect",
      href: `/project/${projectId}/graph`,
    },
  ];
  return (
    <div className="border border-border bg-surface p-5">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        Tools
      </p>
      <ul className="space-y-1">
        {tools.map((t) => (
          <li key={t.label}>
            <Link
              href={t.href}
              className="group flex items-center gap-3 px-2 py-2 -mx-2 hover:bg-violet/[0.06] transition-colors"
            >
              <div className="w-7 h-7 border border-border bg-background flex items-center justify-center shrink-0 group-hover:border-violet/40 transition-colors">
                <t.icon
                  size={12}
                  strokeWidth={1.75}
                  className="text-muted group-hover:text-violet transition-colors"
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-foreground font-medium group-hover:text-violet transition-colors">
                  {t.label}
                </div>
                <div className="text-[10px] text-muted mt-0.5">{t.hint}</div>
              </div>
              <ArrowRight
                size={11}
                className="text-muted opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
