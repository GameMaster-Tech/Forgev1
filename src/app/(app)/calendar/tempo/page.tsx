"use client";

/**
 * Calendar — Tempo.
 *
 * The AI-native scheduling surface. 8/4 main+rail layout, with all
 * internal lists converted to compact card grids so the page no
 * longer reads as a stack of slabs. Priority queue items and focus
 * blocks are visually distinct cards in 2-column grids instead of
 * vertical ul rows. The rail keeps the overload heatmap, conflicts,
 * and unscheduled summaries; each is a card cluster, not a flat list.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  Calendar as CalendarIcon,
  Clock,
  Flame,
  Hourglass,
  Layers,
  ListChecks,
  Pin,
  Plus,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  CONFLICT_LABELS,
  type Conflict,
  type FocusBlock,
  type OverloadPrediction,
  type PlanResult,
} from "@/lib/scheduler";
import { useCalendar } from "../CalendarProvider";
import { ease } from "../_components";
import { TempoEngineCard } from "@/components/forge-graph/TempoEngineCard";
import { useProjectsStore } from "@/store/projects";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useAuth } from "@/context/AuthContext";
import { NewTaskModal } from "@/components/scheduler/NewTaskModal";

export default function CalendarTempoPage() {
  const { user } = useAuth();
  const { planResult } = useCalendar();
  const projects = useProjectsStore((s) => s.projects);
  const { projectId: activeProjectId } = useActiveProject();
  const projectId = activeProjectId ?? projects[0]?.id ?? "demo-project";
  const canCreate = !!user?.uid && !!activeProjectId;
  const [creating, setCreating] = useState(false);

  if (!planResult) {
    return (
      <div className="max-w-4xl mx-auto px-6 sm:px-10 pt-10 pb-16">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-4">
          Planning
        </p>
        <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1]">
          Building your <span className="text-violet">week</span>…
        </h2>
      </div>
    );
  }

  const focusBlocks = planResult.newBlocks.filter((b): b is FocusBlock => b.kind === "focus-block");
  const topItems = [...planResult.items.filter((i) => i.kind === "task" || i.kind === "event")]
    .sort((a, b) => b.priority.score - a.priority.score)
    .slice(0, 5);

  return (
    <>
    <div className="grid grid-cols-12 gap-x-0">
      {/* ── Main column ────────────────────────────────────── */}
      <div className="col-span-12 lg:col-span-8 px-6 sm:px-10 pt-8 pb-16 lg:border-r lg:border-border">
        <div className="flex items-center justify-end mb-3">
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={!canCreate}
            className="inline-flex items-center gap-1.5 bg-violet text-white hover:bg-violet/90 disabled:opacity-50 text-[10px] uppercase tracking-[0.12em] font-semibold px-3 py-1.5 transition-colors"
          >
            <Plus size={11} strokeWidth={2.25} />
            New task
          </button>
        </div>
        <TempoVerdict plan={planResult} />

        {/* Priority queue as a 2-col card grid */}
        <div className="mt-10 pt-6 border-t border-border">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
            <Flame size={11} strokeWidth={1.75} />
            Priority queue · top {topItems.length}
          </p>
          {topItems.length === 0 ? (
            <div className="border border-border bg-surface px-5 py-6 text-center text-muted text-[13px]">
              No active items.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {topItems.map((item, i) => (
                <PriorityCard key={item.id} item={item} rank={i + 1} />
              ))}
            </div>
          )}
        </div>

        {/* Focus blocks as a 2-col card grid */}
        <div className="mt-10 pt-6 border-t border-border">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
            <Layers size={11} strokeWidth={1.75} />
            Focus blocks Tempo placed for you
          </p>
          {focusBlocks.length === 0 ? (
            <div className="border border-border bg-surface px-5 py-6 text-center text-muted text-[13px]">
              No focus blocks needed — your tasks fit the existing free time.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {focusBlocks.slice(0, 6).map((b, i) => (
                <FocusBlockCard key={b.id} block={b} order={i} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Right rail ─────────────────────────────────────── */}
      <aside className="col-span-12 lg:col-span-4 px-6 sm:px-10 pt-8 pb-16 space-y-6">
        <TempoEngineCard projectId={projectId} />
        <OverloadCard predictions={planResult.overload} />
        <ConflictsCluster conflicts={planResult.conflicts} />
        <UnscheduledCluster unscheduled={planResult.unscheduled} />
        <ManifestoCard />
      </aside>
    </div>
    <AnimatePresence>
      {creating && user?.uid && activeProjectId ? (
        <NewTaskModal
          uid={user.uid}
          projectId={activeProjectId}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </AnimatePresence>
    </>
  );
}

/* ── Tempo verdict card ────────────────────────────────────── */

function TempoVerdict({ plan }: { plan: PlanResult }) {
  const highSev = plan.conflicts.filter((c) => c.severity === "high").length;
  const overload = plan.overload.find((d) => d.level >= 3);
  const placed = plan.newBlocks.length;
  const headline = highSev > 0
    ? <><span className="text-rose">{highSev} hard conflict{highSev === 1 ? "" : "s"}</span> in the way.</>
    : overload
    ? <><span className="text-warm">{overload.date.slice(5)}</span> is overcommitted.</>
    : <>Your week is <span className="text-violet">compiled</span>.</>;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        Tempo · last plan
      </p>
      <div className="border border-border bg-surface p-5 sm:p-6 relative">
        <span aria-hidden className="absolute left-0 top-5 bottom-5 w-[2px] bg-violet" />
        <div className="flex items-center gap-2.5 mb-2 flex-wrap">
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold text-violet">
            <Brain size={11} strokeWidth={2} />
            Plan
          </span>
          <span className="w-1 h-1 bg-muted rounded-full" />
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
            ran {new Date(plan.plannedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
        </div>
        <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1]">
          {headline}
        </h2>
        <p className="text-[13px] text-muted mt-3 leading-relaxed max-w-2xl">{plan.summary}</p>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] uppercase tracking-[0.12em] text-muted tabular-nums font-medium">
          <span className="flex items-center gap-1.5 text-violet">
            <Layers size={11} strokeWidth={2} /> {placed} focus blocks
          </span>
          <span className={`flex items-center gap-1.5 ${plan.conflicts.length === 0 ? "text-green" : "text-rose"}`}>
            <AlertTriangle size={11} strokeWidth={2} /> {plan.conflicts.length} conflicts
          </span>
          <span className={`flex items-center gap-1.5 ${plan.unscheduled.length === 0 ? "text-green" : "text-warm"}`}>
            <Hourglass size={11} strokeWidth={2} /> {plan.unscheduled.length} unplaced
          </span>
        </div>
      </div>
    </motion.div>
  );
}

/* ── Priority queue card ───────────────────────────────────── */

function PriorityCard({
  item, rank,
}: {
  item: PlanResult["items"][number];
  rank: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: rank * 0.03, ease }}
      className="border border-border bg-surface px-4 py-3.5 relative"
    >
      <span aria-hidden className="absolute left-0 top-3.5 bottom-3.5 w-[2px] bg-cyan" />
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="font-display font-bold text-muted text-[12px] tabular-nums tracking-tight">
          #{String(rank).padStart(2, "0")}
        </span>
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.15em] font-semibold text-cyan">
          <Zap size={10} strokeWidth={2.25} /> P{Math.round(item.priority.score)}
        </span>
        <span className="text-[10px] text-muted">·</span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium">{item.kind}</span>
        <span className="text-[10px] text-muted">·</span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium">{item.energy}</span>
      </div>
      <div className="text-[14px] text-foreground font-medium leading-snug">{item.title}</div>
      {item.priority.factors.length > 0 && (
        <p className="text-[11px] text-muted leading-relaxed mt-1.5">
          {item.priority.factors.slice(0, 2).map((f) => f.reason).join(" · ")}
        </p>
      )}
    </motion.div>
  );
}

/* ── Focus block card ──────────────────────────────────────── */

function FocusBlockCard({ block, order }: { block: FocusBlock; order: number }) {
  const start = new Date(block.start);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: order * 0.03, ease }}
      className="border border-border bg-surface px-4 py-3.5 relative"
    >
      <span aria-hidden className="absolute left-0 top-3.5 bottom-3.5 w-[2px] bg-violet" />
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-violet">
          {block.energy}
        </span>
        <span className="text-[10px] text-muted">·</span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums inline-flex items-center gap-1">
          <Clock size={9} /> {block.durationMinutes} min
        </span>
      </div>
      <div className="text-[14px] text-foreground font-medium leading-snug">{block.title}</div>
      <div className="mt-1 text-[11px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums inline-flex items-center gap-1.5">
        <CalendarIcon size={10} strokeWidth={1.75} />
        {start.toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}
      </div>
      {block.placementRationale && block.placementRationale.length > 0 && (
        <p className="text-[11px] text-muted leading-relaxed mt-1.5 inline-flex items-baseline gap-1.5">
          <Pin size={9} className="shrink-0 text-muted" />
          {block.placementRationale.join(" · ")}
        </p>
      )}
    </motion.div>
  );
}

/* ── Rail: overload heatmap ────────────────────────────────── */

function OverloadCard({ predictions }: { predictions: OverloadPrediction[] }) {
  const tone = (level: number) => {
    if (level === 0) return "bg-green/30";
    if (level === 1) return "bg-green";
    if (level === 2) return "bg-warm/60";
    if (level === 3) return "bg-warm";
    return "bg-rose";
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.06, ease }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
        <AlertTriangle size={11} strokeWidth={1.75} />
        Overload heatmap · 7d
      </p>
      <div className="border border-border bg-surface px-4 py-4">
        <div className="grid grid-cols-7 gap-1.5">
          {predictions.slice(0, 7).map((p) => (
            <div key={p.date} className="flex flex-col items-center gap-1.5">
              <div className="text-[10px] uppercase tracking-[0.1em] text-muted font-semibold tabular-nums">
                {new Date(p.date).toLocaleDateString("en-US", { weekday: "narrow" })}
              </div>
              <div
                className={`w-full h-12 ${tone(p.level)} relative group cursor-help`}
                title={`${p.date}: ${Math.round(p.committedMinutes / 60 * 10) / 10}h / ${Math.round(p.capacityMinutes / 60)}h${p.reasons.length ? ` — ${p.reasons.join(", ")}` : ""}`}
              >
                <div className="absolute inset-0 flex items-center justify-center text-[10px] font-display font-bold tabular-nums text-foreground">
                  {Math.round(p.load * 100)}%
                </div>
              </div>
              <div className="text-[10px] uppercase tracking-[0.1em] text-muted tabular-nums">
                {new Date(p.date).getDate()}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted mt-3 leading-relaxed">
          Predicted load vs your usual capacity. Tempo proactively flags days {">"} 110%.
        </p>
      </div>
    </motion.div>
  );
}

/* ── Rail: conflicts as a card cluster ─────────────────────── */

function ConflictsCluster({ conflicts }: { conflicts: Conflict[] }) {
  const top = conflicts.slice(0, 3);
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.12, ease }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
        <AlertTriangle size={11} strokeWidth={1.75} />
        Conflicts
      </p>
      {top.length === 0 ? (
        <div className="border border-border bg-surface py-6 px-4 text-center text-muted text-[13px]">
          Clean. Nothing fights for the same slot.
        </div>
      ) : (
        <div className="space-y-2">
          {top.map((c) => (
            <div key={c.id} className="border border-border bg-surface px-4 py-3 relative">
              <span aria-hidden className={`absolute left-0 top-3 bottom-3 w-[2px] ${
                c.severity === "high" ? "bg-rose" : c.severity === "medium" ? "bg-warm" : "bg-muted"
              }`} />
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${
                  c.severity === "high" ? "text-rose" : c.severity === "medium" ? "text-warm" : "text-muted"
                }`}>
                  {CONFLICT_LABELS[c.kind]}
                </span>
              </div>
              <p className="text-[12px] text-foreground leading-relaxed">{c.message}</p>
              {c.suggestion && (
                <p className="text-[11px] text-muted leading-relaxed mt-1 inline-flex items-baseline gap-1.5">
                  <ArrowRight size={9} className="shrink-0 text-muted" />
                  {c.suggestion}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/* ── Rail: unscheduled as a card cluster ───────────────────── */

function UnscheduledCluster({ unscheduled }: { unscheduled: PlanResult["unscheduled"] }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.18, ease }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
        <ListChecks size={11} strokeWidth={1.75} />
        Couldn&apos;t fit
      </p>
      {unscheduled.length === 0 ? (
        <div className="border border-border bg-surface py-6 px-4 text-center text-muted text-[13px]">
          All tasks placed.
        </div>
      ) : (
        <div className="space-y-2">
          {unscheduled.slice(0, 4).map(({ item, reason }) => (
            <div key={item.id} className="border border-border bg-surface px-4 py-3 relative">
              <span aria-hidden className="absolute left-0 top-3 bottom-3 w-[2px] bg-warm" />
              <div className="text-[12.5px] font-medium text-foreground truncate">{item.title}</div>
              <p className="text-[11px] text-muted leading-relaxed mt-0.5">{reason}</p>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

/* ── Rail: manifesto ───────────────────────────────────────── */

function ManifestoCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.24, ease }}
      className="border border-border bg-foreground text-background p-5 relative overflow-hidden"
    >
      <span aria-hidden className="absolute top-0 left-0 w-[2px] h-full bg-violet" />
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={12} strokeWidth={2} className="text-violet" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-background/60 font-medium">
          How tempo works
        </span>
      </div>
      <h3 className="font-display font-bold text-[18px] tracking-[-0.018em] leading-[1.2] mb-3">
        Plan around your <span className="text-violet">energy</span>.
      </h3>
      <p className="text-[13px] text-background/70 leading-relaxed">
        Tempo treats deep focus, shallow admin, and creative work as different fuels. It places the right thing at the right time of day — and lets you keep the parts it got wrong.
      </p>
    </motion.div>
  );
}
