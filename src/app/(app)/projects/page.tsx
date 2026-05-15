"use client";

/**
 * Projects — workspace index with a right-rail companion.
 *
 * Two-column layout (8/4 on desktop, stacked on mobile):
 *   • Main: filter strip → most-recent featured row → numbered list of earlier projects.
 *   • Rail: an opinionated mode legend + a "what's a project" manifesto card.
 *
 * Adds visual interest via informational density on the right rail
 * (legend + manifesto), not via decorative shapes or oversized type.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  FileText,
  Zap,
  Brain,
  Microscope,
  Loader2,
  Plus,
  Search,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { useProjectsStore, type ResearchMode, type Project } from "@/store/projects";
import { useAuth } from "@/context/AuthContext";
import NewProjectModal from "@/components/app/NewProjectModal";

const ease = [0.22, 0.61, 0.36, 1] as const;

const MODE_META: Record<
  ResearchMode,
  { label: string; icon: typeof Zap; accent: string; accentBg: string; blurb: string }
> = {
  lightning: {
    label: "Lightning",
    icon: Zap,
    accent: "text-warm",
    accentBg: "bg-warm",
    blurb: "Snappy answers. 3 sources. Abstract-only. ~5s.",
  },
  reasoning: {
    label: "Reasoning",
    icon: Brain,
    accent: "text-cyan",
    accentBg: "bg-cyan",
    blurb: "Step-by-step. 5 sources. Highlights. DOI verify.",
  },
  deep: {
    label: "Deep",
    icon: Microscope,
    accent: "text-rose",
    accentBg: "bg-rose",
    blurb: "Long synthesis. 10+ sources. Full text. Cross-ref.",
  },
};

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w`;
}

export default function ProjectsPage() {
  const { user } = useAuth();
  const { projects, loading, fetchProjects } = useProjectsStore();
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (user?.uid) fetchProjects(user.uid);
  }, [user?.uid, fetchProjects]);

  const sorted = [...projects].sort((a, b) => b.updatedAt - a.updatedAt);
  const filtered = filter
    ? sorted.filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()))
    : sorted;

  const featured = filtered[0];
  const rest = filtered.slice(1);

  return (
    <div className="min-h-full bg-background">
      {/* ───────────── Header strip ───────────── */}
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="border-b border-border px-6 sm:px-10 pt-10 pb-6 flex flex-col gap-5"
      >
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-2">
              Projects · {sorted.length}
            </p>
            <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
              Workspaces.
            </h1>
          </div>
          <button
            onClick={() => setNewProjectOpen(true)}
            className="flex items-center gap-2 bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150 shrink-0"
          >
            <Plus size={12} strokeWidth={2.25} />
            New project
          </button>
        </div>

        {sorted.length > 0 && (
          <div className="flex items-center gap-3 max-w-md">
            <Search size={14} className="text-muted shrink-0" strokeWidth={1.75} />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter projects…"
              className="flex-1 bg-transparent border-b border-border focus:border-violet outline-none text-[14px] py-1.5 placeholder:text-muted transition-colors"
            />
          </div>
        )}
      </motion.header>

      {/* ───────────── Body — two-column ───────────── */}
      <div className="grid grid-cols-12 gap-x-0">
        {/* Main column */}
        <div className="col-span-12 lg:col-span-8 px-6 sm:px-10 pb-16 lg:border-r lg:border-border">
          {loading ? (
            <div className="flex items-center justify-center py-32">
              <Loader2 size={20} className="animate-spin text-muted" />
            </div>
          ) : filtered.length === 0 ? (
            sorted.length === 0 ? (
              <EmptyState onCreate={() => setNewProjectOpen(true)} />
            ) : (
              <div className="py-24 text-center text-muted text-[14px]">
                No projects match &ldquo;{filter}&rdquo;.
              </div>
            )
          ) : (
            <>
              {featured && <FeaturedRow project={featured} />}

              {rest.length > 0 && (
                <div className="mt-10 pt-6 border-t border-border">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
                    Earlier
                  </p>
                  <ul className="divide-y divide-border">
                    {rest.map((p, i) => (
                      <ProjectRow key={p.id} project={p} index={i + 1} />
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        {/* Right rail companion */}
        <aside className="col-span-12 lg:col-span-4 px-6 sm:px-10 pt-8 pb-16 space-y-6">
          <ModeLegend />
          <ManifestoCard />
        </aside>
      </div>

      <NewProjectModal open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
    </div>
  );
}

/* ── Featured (most-recent) project ─────────────────────────── */
function FeaturedRow({ project }: { project: Project }) {
  const Mode = MODE_META[project.mode];
  const ModeIcon = Mode.icon;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease }}
      className="pt-8 pb-3"
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        Most recent
      </p>
      <Link
        href={`/project/${project.id}`}
        className="group block border border-border bg-surface p-5 hover:border-violet/50 hover:bg-violet/[0.04] transition-colors duration-150 relative"
      >
        <span
          aria-hidden
          className="absolute left-0 top-5 bottom-5 w-[2px] bg-violet"
        />
        <div className="flex items-center gap-2.5 mb-2">
          <span className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold ${Mode.accent}`}>
            <ModeIcon size={11} strokeWidth={2} />
            {Mode.label}
          </span>
          <span className="w-1 h-1 bg-muted rounded-full" />
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
            {timeAgo(project.updatedAt)} ago
          </span>
        </div>
        <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1] group-hover:text-violet transition-colors duration-150">
          {project.name}
        </h2>
        <div className="mt-4 flex items-center gap-5 text-[11px] uppercase tracking-[0.12em] text-muted tabular-nums font-medium">
          <span className="flex items-center gap-1.5">
            <FileText size={11} strokeWidth={1.75} />
            {project.docCount ?? 0} docs
          </span>
          <span className="flex items-center gap-1.5">
            <Search size={11} strokeWidth={1.75} />
            {project.queryCount ?? 0} queries
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-violet group-hover:gap-3 transition-all">
            Open
            <ArrowRight size={12} strokeWidth={2} />
          </span>
        </div>
      </Link>
    </motion.div>
  );
}

/* ── Compact row in the earlier list ──────────────────────────── */
function ProjectRow({ project, index }: { project: Project; index: number }) {
  const Mode = MODE_META[project.mode];
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.max(0, index - 1) * 0.02, ease }}
    >
      <Link
        href={`/project/${project.id}`}
        className="group grid grid-cols-12 items-center gap-x-4 sm:gap-x-6 py-4 hover:bg-violet/[0.06] transition-colors -mx-3 px-3 sm:-mx-4 sm:px-4"
      >
        <span className="col-span-1 font-display font-bold text-muted text-[13px] tabular-nums tracking-tight">
          {String(index).padStart(2, "0")}
        </span>
        <div className="col-span-7 sm:col-span-6 min-w-0">
          <h3 className="font-display font-bold text-foreground text-[16px] sm:text-[18px] tracking-[-0.018em] leading-tight truncate group-hover:text-violet transition-colors duration-150">
            {project.name}
          </h3>
        </div>
        <span
          className={`hidden sm:flex items-center gap-1.5 col-span-2 text-[10px] uppercase tracking-[0.15em] font-semibold ${Mode.accent}`}
        >
          <span className={`w-1.5 h-1.5 ${Mode.accentBg}`} />
          {Mode.label}
        </span>
        <span className="col-span-3 sm:col-span-2 flex items-center gap-3 text-[11px] uppercase tracking-[0.12em] text-muted tabular-nums font-medium justify-end">
          <span className="hidden sm:inline">{project.docCount ?? 0} docs</span>
          <span>{timeAgo(project.updatedAt)}</span>
        </span>
        <span className="col-span-1 flex justify-end">
          <ArrowRight size={13} strokeWidth={1.75} className="text-muted group-hover:text-violet transition-colors" />
        </span>
      </Link>
    </motion.li>
  );
}

/* ── Right-rail: mode legend ─────────────────────────────────── */
function ModeLegend() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1, ease }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        Reasoning modes
      </p>
      <div className="border border-border bg-surface divide-y divide-border">
        {(Object.entries(MODE_META) as [ResearchMode, typeof MODE_META[ResearchMode]][]).map(([key, m]) => {
          const Icon = m.icon;
          return (
            <div key={key} className="flex items-start gap-3.5 px-4 py-3.5">
              <div className={`mt-0.5 w-6 h-6 border border-border bg-background flex items-center justify-center shrink-0`}>
                <Icon size={12} strokeWidth={1.75} className={m.accent} />
              </div>
              <div className="min-w-0 flex-1">
                <div className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${m.accent}`}>
                  {m.label}
                </div>
                <p className="text-[12px] text-muted leading-relaxed mt-0.5">
                  {m.blurb}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

/* ── Right-rail: manifesto card ──────────────────────────────── */
function ManifestoCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.18, ease }}
      className="border border-border bg-foreground text-background p-5 relative overflow-hidden"
    >
      <span
        aria-hidden
        className="absolute top-0 left-0 w-[2px] h-full bg-violet"
      />
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={12} strokeWidth={2} className="text-violet" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-background/60 font-medium">
          What&apos;s a project?
        </span>
      </div>
      <h3 className="font-display font-bold text-[18px] tracking-[-0.018em] leading-[1.2] mb-3">
        One investigation. <span className="text-violet">One memory.</span>
      </h3>
      <p className="text-[13px] text-background/70 leading-relaxed mb-4">
        Each project carries its own claims, sources, verified citations, and reasoning history. Veritas-R1 reads the whole project before it answers anything inside it.
      </p>
      <div className="flex items-center gap-1.5 text-[11px] text-background/55 font-medium">
        <ShieldCheck size={11} strokeWidth={1.75} />
        Persistent across sessions
      </div>
    </motion.div>
  );
}

/* ── Empty state ─────────────────────────────────────────────── */
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="py-20 max-w-2xl">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-4">
        Empty
      </p>
      <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1] mb-4">
        No projects <span className="text-violet">yet</span>.
      </h2>
      <p className="text-[14px] text-muted leading-relaxed mb-7 max-w-md">
        A project is a workspace for one investigation — its own claims, sources, documents, and AI memory. Start one and Forge takes care of the rest.
      </p>
      <button
        onClick={onCreate}
        className="inline-flex items-center gap-2 bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
      >
        <Plus size={12} strokeWidth={2.25} />
        Create first project
        <ArrowRight size={12} strokeWidth={2} className="ml-1" />
      </button>
    </div>
  );
}
