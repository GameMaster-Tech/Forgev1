"use client";

/**
 * History — chronological version browser.
 *
 * Matches Forge's "Obsidian Ink" page template: header strip + main
 * timeline + filter rail. Each row shows source, title, summary, and
 * a Propose-restore button (only on restorable rows).
 */

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  History,
  Filter,
  GitBranch,
  Activity,
  Network,
  Calendar as CalendarIcon,
  Flame,
  CheckCircle2,
  Search,
  X,
  AlertCircle,
} from "lucide-react";
import { getVersionStore, type Version, type VersionSource, type RestoreProposal } from "@/lib/versions";

const ease = [0.22, 0.61, 0.36, 1] as const;

const SOURCE_META: Record<VersionSource, { label: string; icon: typeof History; tone: string; bg: string }> = {
  "sync.patch":               { label: "Sync · patch",         icon: GitBranch,    tone: "text-violet", bg: "bg-violet" },
  "pulse.refactor.accept":    { label: "Pulse · accepted",     icon: Activity,     tone: "text-cyan",   bg: "bg-cyan"   },
  "pulse.refactor.reject":    { label: "Pulse · rejected",     icon: Activity,     tone: "text-warm",   bg: "bg-warm"   },
  "lattice.rebranch":         { label: "Lattice · rebranch",   icon: Network,      tone: "text-violet", bg: "bg-violet" },
  "lattice.subtask.decompose":{ label: "Lattice · decompose",  icon: Network,      tone: "text-violet", bg: "bg-violet" },
  "calendar.event.upsert":    { label: "Calendar · upsert",    icon: CalendarIcon, tone: "text-cyan",   bg: "bg-cyan"   },
  "calendar.event.delete":    { label: "Calendar · delete",    icon: CalendarIcon, tone: "text-rose",   bg: "bg-rose"   },
  "tempo.replan":             { label: "Tempo · replan",       icon: CalendarIcon, tone: "text-violet", bg: "bg-violet" },
  "habit.completed":          { label: "Habit · completed",    icon: Flame,        tone: "text-green",  bg: "bg-green"  },
  "habit.undo":               { label: "Habit · undo",         icon: Flame,        tone: "text-warm",   bg: "bg-warm"   },
};

export default function HistoryPage() {
  const [versions, setVersions] = useState<Version[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Set<VersionSource>>(new Set());
  const [proposal, setProposal] = useState<RestoreProposal | null>(null);

  // Subscribe to the store + initial load.
  useEffect(() => {
    const store = getVersionStore();
    let cancelled = false;
    void store.list({ limit: 200 }).then((list) => {
      if (!cancelled) setVersions(list);
    });
    const unsub = store.subscribe((v) => {
      setVersions((prev) => [v, ...prev].slice(0, 200));
    });
    return () => { cancelled = true; unsub(); };
  }, []);

  const filtered = useMemo(() => {
    return versions.filter((v) => {
      if (filter.size > 0 && !filter.has(v.source)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!v.title.toLowerCase().includes(q) && !v.summary.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [versions, filter, search]);

  const toggleSource = (s: VersionSource) => {
    setFilter((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  async function handleRestore(v: Version) {
    const p = await getVersionStore().proposeRestore(v.id);
    if (p) setProposal(p);
  }

  return (
    <div className="min-h-full bg-background">
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="px-4 sm:px-10 pt-10 pb-6 flex flex-col gap-6 border-b border-border"
      >
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="max-w-2xl">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-2 flex items-center gap-2">
              <History size={11} strokeWidth={1.75} />
              History · time-travel
            </p>
            <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
              Every change, in <span className="text-violet">chronological order</span>.
            </h1>
            <p className="text-[13px] text-muted mt-3 leading-relaxed">
              Every Sync patch, Pulse refactor, Lattice rebranch, calendar mutation, and habit completion lands here. Click <span className="text-violet font-medium">Propose restore</span> on any restorable entry — Forge drafts the inverse and routes it through the original system for review.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 flex items-center gap-2 border border-border bg-background px-3 py-2 focus-within:border-violet transition-colors">
            <Search size={12} className="text-muted shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title or summary…"
              className="flex-1 bg-transparent outline-none text-[13px] placeholder:text-muted"
            />
            {search && (
              <button onClick={() => setSearch("")} className="text-muted hover:text-foreground" aria-label="Clear">
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-x-2 gap-y-2 flex-wrap">
          <Filter size={11} className="text-muted shrink-0" />
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-semibold mr-1">Source</span>
          {(Object.keys(SOURCE_META) as VersionSource[]).map((s) => {
            const meta = SOURCE_META[s];
            const active = filter.has(s);
            return (
              <button
                key={s}
                onClick={() => toggleSource(s)}
                className={`text-[10px] uppercase tracking-[0.12em] font-semibold px-2.5 py-1 border transition-colors duration-150 inline-flex items-center gap-1.5 ${
                  active ? `${meta.tone} border-current` : "text-muted border-border hover:text-foreground hover:border-foreground"
                }`}
              >
                <span className={`w-1.5 h-1.5 ${meta.bg}`} />
                {meta.label}
              </button>
            );
          })}
          {filter.size > 0 && (
            <button onClick={() => setFilter(new Set())} className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-foreground ml-2">
              Clear · {filter.size}
            </button>
          )}
        </div>
      </motion.header>

      <div className="px-4 sm:px-10 py-8">
        {filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <ol className="relative max-w-4xl">
            <span aria-hidden className="absolute left-[26px] top-3 bottom-3 w-px bg-border" />
            {filtered.map((v, i) => (
              <VersionRow key={v.id} version={v} index={i} onRestore={handleRestore} />
            ))}
          </ol>
        )}
      </div>

      <AnimatePresence>
        {proposal && <RestoreDialog proposal={proposal} onClose={() => setProposal(null)} />}
      </AnimatePresence>
    </div>
  );
}

function VersionRow({ version, index, onRestore }: { version: Version; index: number; onRestore: (v: Version) => void }) {
  const meta = SOURCE_META[version.source];
  const Icon = meta.icon;
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index, 10) * 0.02, ease }}
      className="relative pl-12 pr-4 py-3 hover:bg-violet/[0.05] transition-colors group"
    >
      <span className={`absolute left-[22px] top-5 w-2 h-2 ${meta.bg} ring-2 ring-background`} aria-hidden />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <Icon size={10} className={meta.tone} strokeWidth={2} />
            <span className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${meta.tone}`}>{meta.label}</span>
            <span className="text-[10px] text-muted">·</span>
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
              {new Date(version.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
          </div>
          <h3 className="text-[14px] font-medium text-foreground leading-tight">{version.title}</h3>
          {version.summary && <p className="text-[12.5px] text-muted leading-relaxed mt-1">{version.summary}</p>}
        </div>
        {version.restorable && (
          <button
            onClick={() => onRestore(version)}
            className="text-[10px] uppercase tracking-[0.12em] font-semibold text-violet border border-violet/40 hover:bg-violet hover:text-white transition-colors px-2.5 py-1.5 shrink-0 focus-ring"
          >
            Propose restore
          </button>
        )}
      </div>
    </motion.li>
  );
}

function EmptyState() {
  return (
    <div className="border border-border bg-surface py-20 px-8 text-center max-w-2xl mx-auto">
      <div className="mx-auto w-10 h-10 border border-border bg-background flex items-center justify-center mb-3">
        <History size={14} className="text-muted" strokeWidth={2} />
      </div>
      <h3 className="font-display font-bold text-foreground text-[18px] tracking-[-0.018em] mb-1">No history yet.</h3>
      <p className="text-[13px] text-muted leading-relaxed max-w-md mx-auto">
        Apply a Sync patch, accept a Pulse refactor, decompose a Lattice task, or complete a habit — each lands here automatically.
      </p>
    </div>
  );
}

function RestoreDialog({ proposal, onClose }: { proposal: RestoreProposal; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-foreground/30 z-50 flex items-end sm:items-center sm:justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Restore proposal"
    >
      <motion.div
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 12, opacity: 0 }}
        transition={{ duration: 0.22, ease }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-background border border-border shadow-[0_30px_80px_-20px_rgba(0,0,0,0.4)]"
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold">Restore proposal</span>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-muted hover:text-foreground" aria-label="Close"><X size={14} /></button>
        </div>
        <div className="px-5 py-5">
          <div className={`flex items-center gap-2 mb-3 text-[10px] uppercase tracking-[0.15em] font-semibold ${proposal.safety === "safe" ? "text-green" : "text-warm"}`}>
            {proposal.safety === "safe" ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
            {proposal.safety === "safe" ? "Safe to apply" : "Review required"}
          </div>
          <p className="text-[14px] text-foreground leading-relaxed">{proposal.description}</p>
          <pre className="mt-4 text-[11px] text-muted leading-relaxed bg-surface border border-border p-3 overflow-x-auto">
{JSON.stringify(proposal.action, null, 2)}
          </pre>
        </div>
        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-foreground px-3 py-2">Cancel</button>
          <button
            onClick={onClose}
            className="bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2 transition-colors"
          >
            Route through source
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
