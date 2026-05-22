"use client";

/**
 * Calendar — Goals (list).
 *
 * Each active goal is a self-contained card in a 2-column grid (no
 * more featured-row + numbered-list slab). The card surfaces the
 * goal title, weekly progress bar, target date, and the count of
 * Tempo's proposed time-pulls. Clicking opens
 * /calendar/goals/[goalId] for the full goal detail with every
 * proposed pull listed.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Layers,
  Pin,
  Plus,
  Sparkles,
  Target,
} from "lucide-react";
import type { Goal, GoalBlock, PlanResult } from "@/lib/scheduler";
import { useCalendar } from "../CalendarProvider";
import { ease } from "../_components";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useAuth } from "@/context/AuthContext";
import { NewGoalModal } from "@/components/scheduler/NewGoalModal";

type Filter = "all" | "behind" | "on-track";

export default function CalendarGoalsListPage() {
  const { user } = useAuth();
  const { projectId } = useActiveProject();
  const { scheduleBundle, planResult } = useCalendar();
  const goals = scheduleBundle.goals.filter((g) => g.status === "active");
  const canCreate = !!user?.uid && !!projectId;
  const [creating, setCreating] = useState(false);

  const [filter, setFilter] = useState<Filter>("all");

  // Hooks declared before any conditional return so the rules-of-hooks
  // stay intact when the goals array is empty.
  const ordered = useMemo(
    () => [...goals].sort((a, b) => pctOf(a) - pctOf(b)),
    [goals],
  );
  const behind  = useMemo(() => ordered.filter((g) => pctOf(g) < 60),  [ordered]);
  const onTrack = useMemo(() => ordered.filter((g) => pctOf(g) >= 60), [ordered]);

  if (goals.length === 0) {
    return (
      <>
        <div className="max-w-4xl mx-auto px-6 sm:px-10 pt-10 pb-16">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-4">
            No goals yet
          </p>
          <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1] mb-4">
            Aim at <span className="text-violet">something</span>.
          </h2>
          <p className="text-[14px] text-muted leading-relaxed max-w-md mb-5">
            Set a weekly target and Forge will protect time for it on your calendar.
          </p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={!canCreate}
            className="inline-flex items-center gap-2 bg-violet text-white hover:bg-violet/90 disabled:opacity-50 text-[11px] uppercase tracking-[0.12em] font-semibold px-4 py-2.5 transition-colors"
          >
            <Plus size={12} strokeWidth={2.25} />
            New goal
          </button>
          {!canCreate ? (
            <p className="text-[11px] text-muted mt-3">
              Open a project from the sidebar to create goals.
            </p>
          ) : null}
        </div>
        <AnimatePresence>
          {creating && user?.uid && projectId ? (
            <NewGoalModal
              uid={user.uid}
              projectId={projectId}
              onClose={() => setCreating(false)}
            />
          ) : null}
        </AnimatePresence>
      </>
    );
  }

  const blocksByGoal = groupBlocksByGoal(planResult);
  const visible = filter === "behind" ? behind : filter === "on-track" ? onTrack : ordered;

  return (
    <>
    <div className="max-w-6xl mx-auto px-6 sm:px-10 pt-8 pb-16">
      <div className="flex items-end justify-between gap-3 mb-4 flex-wrap">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium flex items-center gap-2">
          <Target size={11} strokeWidth={1.75} />
          {goals.length} active goal{goals.length === 1 ? "" : "s"} · sorted by deficit
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          disabled={!canCreate}
          className="inline-flex items-center gap-1.5 bg-violet text-white hover:bg-violet/90 disabled:opacity-50 text-[10px] uppercase tracking-[0.12em] font-semibold px-3 py-1.5 transition-colors"
        >
          <Plus size={11} strokeWidth={2.25} />
          New goal
        </button>
      </div>

      <FilterChips
        filter={filter}
        onChange={setFilter}
        allCount={goals.length}
        behindCount={behind.length}
        onTrackCount={onTrack.length}
      />

      {visible.length === 0 ? (
        <FilterEmpty onReset={() => setFilter("all")} />
      ) : (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map((g, i) => (
            <GoalSummaryCard
              key={g.id}
              goal={g}
              blockCount={(blocksByGoal.get(g.id) ?? []).length}
              order={i}
            />
          ))}
        </div>
      )}
    </div>
    <AnimatePresence>
      {creating && user?.uid && projectId ? (
        <NewGoalModal
          uid={user.uid}
          projectId={projectId}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </AnimatePresence>
    </>
  );
}

/* ── Summary card (link to detail) ─────────────────────────── */

function GoalSummaryCard({
  goal, blockCount, order,
}: {
  goal: Goal;
  blockCount: number;
  order: number;
}) {
  const pct = pctOf(goal);
  const tone = pct >= 100 ? "bg-green" : pct >= 60 ? "bg-violet" : pct >= 30 ? "bg-warm" : "bg-rose";
  const accent = pct < 60 ? "bg-warm" : "bg-violet";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(order, 12) * 0.035, ease }}
    >
      <Link
        href={`/calendar/goals/${encodeURIComponent(goal.id)}`}
        prefetch
        className="group block border border-border bg-surface p-5 relative forge-lift hover:border-violet/50 hover:bg-violet/[0.04] h-full"
      >
        <span aria-hidden className={`absolute left-0 top-5 bottom-5 w-[2px] ${accent}`} />

        {/* top row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold text-violet">
              <Target size={11} strokeWidth={2} />
              Goal
            </span>
            <span className="text-[10px] text-muted">·</span>
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
              {pct}%
            </span>
          </div>
          <ArrowRight
            size={14}
            strokeWidth={1.75}
            className="text-muted opacity-50 group-hover:opacity-100 group-hover:text-violet group-hover:translate-x-1 transition-all shrink-0 mt-0.5"
          />
        </div>

        {/* title */}
        <h3 className="font-display font-bold text-foreground text-[17px] sm:text-[19px] tracking-[-0.018em] leading-tight group-hover:text-violet transition-colors">
          {goal.title}
        </h3>

        {/* description */}
        {goal.description && (
          <p className="text-[12px] text-muted leading-relaxed mt-2 line-clamp-2">{goal.description}</p>
        )}

        {/* progress bar */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] font-medium tabular-nums mb-1">
            <span className="text-muted">Weekly</span>
            <span className="text-foreground">
              {Math.round(goal.loggedMinutes / 60 * 10) / 10}h / {Math.round(goal.weeklyMinutesTarget / 60 * 10) / 10}h
            </span>
          </div>
          <div className="h-1.5 bg-border-light w-full overflow-hidden">
            <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* footer meta */}
        <div className="mt-4 pt-3 border-t border-border-light flex items-center gap-x-4 gap-y-1 flex-wrap text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
          {goal.targetDate && (
            <span>
              target {new Date(goal.targetDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
            </span>
          )}
          {blockCount > 0 && (
            <span className="inline-flex items-center gap-1 text-violet">
              <Pin size={9} /> {blockCount} pull{blockCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </Link>
    </motion.div>
  );
}

/* ── Filter chips ──────────────────────────────────────────── */

function FilterChips({
  filter, onChange, allCount, behindCount, onTrackCount,
}: {
  filter: Filter;
  onChange: (f: Filter) => void;
  allCount: number;
  behindCount: number;
  onTrackCount: number;
}) {
  const chips: { key: Filter; label: string; count: number; dot: string }[] = [
    { key: "all",      label: "All",       count: allCount,     dot: "bg-foreground" },
    { key: "behind",   label: "Behind",    count: behindCount,  dot: "bg-warm" },
    { key: "on-track", label: "On track",  count: onTrackCount, dot: "bg-violet" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => {
        const active = filter === c.key;
        return (
          <button
            key={c.key}
            onClick={() => onChange(c.key)}
            disabled={c.count === 0}
            className={`flex items-center gap-2 px-3 h-9 text-[10px] uppercase tracking-[0.12em] font-semibold transition-colors duration-150 border disabled:opacity-40 disabled:cursor-not-allowed ${
              active
                ? "bg-foreground text-background border-foreground"
                : "bg-background text-muted hover:text-foreground hover:border-violet border-border"
            }`}
          >
            {c.key === "all" ? <Layers size={11} strokeWidth={2} /> : <span aria-hidden className={`w-1.5 h-1.5 ${c.dot}`} />}
            {c.label}
            <span className={`tabular-nums ${active ? "text-background/65" : "text-muted"}`}>
              {c.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Filter-empty ──────────────────────────────────────────── */

function FilterEmpty({ onReset }: { onReset: () => void }) {
  return (
    <div className="mt-8 border border-border bg-surface px-6 py-10 text-center">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        Empty filter
      </p>
      <h3 className="font-display font-bold text-foreground text-[20px] tracking-[-0.018em] mb-2">
        Nothing matches this <span className="text-violet">view</span>.
      </h3>
      <button
        onClick={onReset}
        className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-violet hover:underline mt-3"
      >
        Back to all goals
        <ArrowRight size={11} strokeWidth={2} />
      </button>
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────────── */

function pctOf(g: Goal): number {
  return g.weeklyMinutesTarget === 0 ? 0 : Math.min(100, Math.round((g.loggedMinutes / g.weeklyMinutesTarget) * 100));
}

function groupBlocksByGoal(plan: PlanResult | null): Map<string, GoalBlock[]> {
  const m = new Map<string, GoalBlock[]>();
  for (const b of plan?.newBlocks ?? []) {
    if (b.kind !== "goal-block") continue;
    const arr = m.get(b.goalId) ?? [];
    arr.push(b);
    m.set(b.goalId, arr);
  }
  return m;
}
