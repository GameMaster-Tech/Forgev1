"use client";

/**
 * Calendar — Goal detail.
 *
 * One goal, in full. Display-type title, full description, weekly
 * progress bar with hours logged vs target, and every proposed
 * time-pull rendered as its own row with energy, duration, weekday
 * slot, and the placement rationale. Prev/next walks the
 * deficit-sorted goal list.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Pin,
  Sparkles,
  Target,
} from "lucide-react";
import type { Goal, GoalBlock, PlanResult } from "@/lib/scheduler";
import { useCalendar } from "../../CalendarProvider";
import { ease } from "../../_components";

export default function CalendarGoalDetailPage() {
  const params = useParams<{ goalId: string }>();
  const { scheduleBundle, planResult } = useCalendar();

  const targetId = useMemo(() => {
    const raw = params?.goalId;
    if (!raw) return null;
    try { return decodeURIComponent(String(raw)); } catch { return String(raw); }
  }, [params]);

  const ordered = useMemo(() => {
    return [...scheduleBundle.goals.filter((g) => g.status === "active")].sort(
      (a, b) => pctOf(a) - pctOf(b),
    );
  }, [scheduleBundle.goals]);

  const index = ordered.findIndex((g) => g.id === targetId);
  const goal = index >= 0 ? ordered[index] : null;
  const prev = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;

  if (!goal) {
    return (
      <div className="max-w-4xl mx-auto px-6 sm:px-10 pt-10 pb-16">
        <Link
          href="/calendar/goals"
          prefetch
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground font-medium mb-6"
        >
          <ArrowLeft size={11} strokeWidth={2} />
          Back to goals
        </Link>
        <div className="border border-border bg-surface px-6 py-10 text-center">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
            Not found
          </p>
          <h3 className="font-display font-bold text-foreground text-[20px] tracking-[-0.018em] mb-2">
            That goal isn&apos;t <span className="text-violet">active</span>.
          </h3>
          <p className="text-[13px] text-muted leading-relaxed mb-5 max-w-md mx-auto">
            It may have been completed, archived, or paused since this URL was generated.
          </p>
          <Link
            href="/calendar/goals"
            prefetch
            className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-violet hover:underline"
          >
            Back to goals
            <ArrowRight size={11} strokeWidth={2} />
          </Link>
        </div>
      </div>
    );
  }

  const pct = pctOf(goal);
  const tone = pct >= 100 ? "bg-green" : pct >= 60 ? "bg-violet" : pct >= 30 ? "bg-warm" : "bg-rose";
  const accent = pct < 60 ? "bg-warm" : "bg-violet";
  const proposed = (planResult?.newBlocks ?? []).filter(
    (b): b is GoalBlock => b.kind === "goal-block" && b.goalId === goal.id,
  );

  return (
    <div className="max-w-5xl mx-auto px-6 sm:px-10 pt-8 pb-16">
      <Link
        href="/calendar/goals"
        prefetch
        className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground font-medium mb-5"
      >
        <ArrowLeft size={11} strokeWidth={2} />
        All goals
      </Link>

      <NavBar index={index} total={ordered.length} prev={prev} next={next} />

      <motion.div
        key={goal.id}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease }}
        className="mt-6 border border-border bg-surface p-5 sm:p-7 relative"
      >
        <span aria-hidden className={`absolute left-0 top-7 bottom-7 w-[2px] ${accent}`} />

        <div className="flex items-center gap-2.5 mb-2 flex-wrap">
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold text-violet">
            <Target size={11} strokeWidth={2} />
            Active goal
          </span>
          <span className="w-1 h-1 bg-muted rounded-full" />
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
            {pct}% this week
          </span>
          {goal.targetDate && (
            <>
              <span className="w-1 h-1 bg-muted rounded-full" />
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
                target {new Date(goal.targetDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            </>
          )}
        </div>

        <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1]">
          {goal.title}
        </h2>
        {goal.description && (
          <p className="text-[14px] text-muted mt-3 leading-relaxed max-w-2xl">{goal.description}</p>
        )}

        {/* progress bar — display-size */}
        <div className="mt-6">
          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.12em] font-medium tabular-nums mb-1.5">
            <span className="text-muted">Weekly progress</span>
            <span className="text-foreground">
              {Math.round(goal.loggedMinutes / 60 * 10) / 10}h / {Math.round(goal.weeklyMinutesTarget / 60 * 10) / 10}h ·{" "}
              <span className="text-violet">{pct}%</span>
            </span>
          </div>
          <div className="h-2 bg-border-light w-full overflow-hidden">
            <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* proposed pulls */}
        {proposed.length > 0 ? (
          <div className="mt-6 pt-5 border-t border-border-light">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
              <Pin size={11} strokeWidth={1.75} />
              Proposed pulls · {proposed.length}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {proposed.map((b) => (
                <div key={b.id} className="border border-border bg-background px-4 py-3 relative">
                  <span aria-hidden className="absolute left-0 top-3 bottom-3 w-[2px] bg-violet" />
                  <div className="text-[10px] uppercase tracking-[0.12em] text-violet font-semibold mb-0.5">
                    {b.energy} · {b.durationMinutes} min
                  </div>
                  <div className="text-[12.5px] text-foreground font-medium tabular-nums">
                    {new Date(b.start).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}
                    <ArrowRight size={10} className="inline mx-1.5 text-muted align-baseline" />
                    {new Date(b.end).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  </div>
                  {b.placementRationale && b.placementRationale.length > 0 && (
                    <p className="text-[11px] text-muted leading-relaxed mt-1">
                      {b.placementRationale.join(" · ")}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-6 pt-5 border-t border-border-light">
            <p className="text-[12px] text-muted leading-relaxed inline-flex items-baseline gap-1.5">
              <Sparkles size={10} className="text-muted shrink-0" />
              Tempo finds nothing under-filled this week — no goal-blocks needed.
            </p>
          </div>
        )}
      </motion.div>
    </div>
  );
}

/* ── nav bar ───────────────────────────────────────────────── */

function NavBar({
  index, total, prev, next,
}: {
  index: number;
  total: number;
  prev: Goal | null;
  next: Goal | null;
}) {
  return (
    <div className="border border-border bg-surface flex items-stretch">
      <PrevNextButton direction="prev" goal={prev} disabled={!prev} />
      <div className="flex-1 flex items-center justify-center px-4 py-3 border-x border-border">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium tabular-nums">
          #{String(index + 1).padStart(2, "0")} of {total}
        </span>
      </div>
      <PrevNextButton direction="next" goal={next} disabled={!next} />
    </div>
  );
}

function PrevNextButton({
  direction, goal, disabled,
}: {
  direction: "prev" | "next";
  goal: Goal | null;
  disabled: boolean;
}) {
  const isPrev = direction === "prev";
  if (disabled || !goal) {
    return (
      <div className={`flex-1 min-w-0 px-4 py-3 flex items-center gap-2 text-muted/50 ${isPrev ? "justify-start" : "justify-end"}`}>
        {isPrev && <ChevronLeft size={12} strokeWidth={2} />}
        <span className="text-[10px] uppercase tracking-[0.12em] font-semibold">
          {isPrev ? "First goal" : "Last goal"}
        </span>
        {!isPrev && <ChevronRight size={12} strokeWidth={2} />}
      </div>
    );
  }
  return (
    <Link
      href={`/calendar/goals/${encodeURIComponent(goal.id)}`}
      prefetch
      className={`flex-1 min-w-0 px-4 py-3 flex items-center gap-2 text-foreground hover:bg-violet/[0.06] hover:text-violet transition-colors group ${isPrev ? "justify-start" : "justify-end"}`}
    >
      {isPrev && <ChevronLeft size={12} strokeWidth={2} className="group-hover:-translate-x-0.5 transition-transform" />}
      <div className={`min-w-0 ${isPrev ? "text-left" : "text-right"}`}>
        <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted group-hover:text-violet transition-colors">
          {isPrev ? "Prev" : "Next"}
        </div>
        <div className="text-[12px] font-medium text-foreground truncate">{goal.title}</div>
      </div>
      {!isPrev && <ChevronRight size={12} strokeWidth={2} className="group-hover:translate-x-0.5 transition-transform" />}
    </Link>
  );
}

/* ── helpers ───────────────────────────────────────────────── */

function pctOf(g: Goal): number {
  return g.weeklyMinutesTarget === 0 ? 0 : Math.min(100, Math.round((g.loggedMinutes / g.weeklyMinutesTarget) * 100));
}
