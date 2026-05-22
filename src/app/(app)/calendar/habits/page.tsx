"use client";

/**
 * Calendar — Habits.
 *
 * Breaks the slab-list pattern: every habit becomes a self-contained
 * card with its streak, cadence, and 90-day heatmap visible at a
 * glance. Two-column grid on desktop (single on mobile) so density
 * stays high but the visual rhythm doesn't read as a long row stack.
 * The right rail summarises today's progress and explains how
 * streaks survive a single miss.
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  Circle,
  Flame,
  Loader2,
  Plus,
  Sparkles,
  Target,
} from "lucide-react";
import { describeRRule, type CompletionEntry, type Habit, type StreakResult } from "@/lib/scheduler";
import { useCalendar } from "../CalendarProvider";
import { ease } from "../_components";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useAuth } from "@/context/AuthContext";
import { NewHabitModal } from "@/components/scheduler/NewHabitModal";

const DAY = 86_400_000;

export default function CalendarHabitsPage() {
  const { user } = useAuth();
  const { projectId } = useActiveProject();
  const [creating, setCreating] = useState(false);
  const {
    scheduleBundle,
    completionsByHabit,
    streaksByHabit,
    pendingHabitId,
    completeHabit,
    undoHabit,
  } = useCalendar();

  const habits = scheduleBundle.habits.filter((h) => !h.archivedAt);
  const canCreate = !!user?.uid && !!projectId;

  if (habits.length === 0) {
    return (
      <>
        <div className="max-w-4xl mx-auto px-6 sm:px-10 pt-10 pb-16">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-4">
            No habits yet
          </p>
          <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1] mb-4">
            Build the <span className="text-violet">spine</span>.
          </h2>
          <p className="text-[14px] text-muted leading-relaxed max-w-md mb-5">
            Habits are recurring commitments Forge schedules around your other work. One miss won&apos;t break your streak.
          </p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            disabled={!canCreate}
            className="inline-flex items-center gap-2 bg-violet text-white hover:bg-violet/90 disabled:opacity-50 text-[11px] uppercase tracking-[0.12em] font-semibold px-4 py-2.5 transition-colors"
          >
            <Plus size={12} strokeWidth={2.25} />
            New habit
          </button>
          {!canCreate ? (
            <p className="text-[11px] text-muted mt-3">
              Open a project from the sidebar to create habits.
            </p>
          ) : null}
        </div>
        <AnimatePresence>
          {creating && user?.uid && projectId ? (
            <NewHabitModal
              uid={user.uid}
              projectId={projectId}
              onClose={() => setCreating(false)}
            />
          ) : null}
        </AnimatePresence>
      </>
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const dueToday = habits.filter((h) => {
    const done = (completionsByHabit.get(h.id) ?? []).some((c) => c.date === today);
    return !done;
  }).length;
  const totalStreak = [...streaksByHabit.values()].reduce((acc, s) => acc + s.streak, 0);

  return (
    <>
    <div className="grid grid-cols-12 gap-x-0">
      {/* ── Main column ────────────────────────────────────── */}
      <div className="col-span-12 lg:col-span-8 px-6 sm:px-10 pt-8 pb-16 lg:border-r lg:border-border">
        <div className="flex items-end justify-between gap-3 mb-4 flex-wrap">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium">
            {habits.length} active · {dueToday} due today
          </p>
          <div className="flex items-center gap-3">
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
              streak {totalStreak}d
            </span>
            <button
              type="button"
              onClick={() => setCreating(true)}
              disabled={!canCreate}
              className="inline-flex items-center gap-1.5 bg-violet text-white hover:bg-violet/90 disabled:opacity-50 text-[10px] uppercase tracking-[0.12em] font-semibold px-3 py-1.5 transition-colors"
            >
              <Plus size={11} strokeWidth={2.25} />
              New habit
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {habits.map((h, i) => (
            <HabitCard
              key={h.id}
              habit={h}
              completions={completionsByHabit.get(h.id) ?? []}
              streak={streaksByHabit.get(h.id)}
              pending={pendingHabitId === h.id}
              order={i}
              onComplete={() => completeHabit(h.id)}
              onUndo={(date) => undoHabit(h.id, date)}
            />
          ))}
        </div>
      </div>

      {/* ── Right rail ─────────────────────────────────────── */}
      <aside className="col-span-12 lg:col-span-4 px-6 sm:px-10 pt-8 pb-16 space-y-6">
        <TodaySummary
          dueToday={dueToday}
          totalToday={habits.length}
          totalStreak={totalStreak}
        />
        <ManifestoCard />
      </aside>
    </div>
    <AnimatePresence>
      {creating && user?.uid && projectId ? (
        <NewHabitModal
          uid={user.uid}
          projectId={projectId}
          onClose={() => setCreating(false)}
        />
      ) : null}
    </AnimatePresence>
    </>
  );
}

/* ── Habit card ────────────────────────────────────────────── */

function HabitCard({
  habit, completions, streak, pending, order, onComplete, onUndo,
}: {
  habit: Habit;
  completions: CompletionEntry[];
  streak: StreakResult | undefined;
  pending: boolean;
  order: number;
  onComplete: () => void;
  onUndo: (date: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const doneToday = completions.some((c) => c.date === today);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(order, 10) * 0.04, ease }}
      className="border border-border bg-surface p-5 relative"
    >
      <span aria-hidden className="absolute left-0 top-5 bottom-5 w-[2px] bg-violet" />

      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-cyan">
              {describeRRule(habit.rrule)}
            </span>
            <span className="w-1 h-1 bg-muted rounded-full" />
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
              {habit.durationMinutes} min
            </span>
          </div>
          <h3 className="font-display font-bold text-[18px] tracking-[-0.018em] text-foreground leading-tight">
            {habit.title}
          </h3>
        </div>
        {streak && streak.streak > 0 && (
          <div className="text-right shrink-0">
            <div className="inline-flex items-baseline gap-1 text-warm tabular-nums">
              <Flame size={14} strokeWidth={2.25} className="self-center" />
              <span className="font-display font-bold text-[20px] tracking-tight">{streak.streak}</span>
              <span className="text-[10px] uppercase tracking-[0.12em] font-semibold">d</span>
            </div>
            <div className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums mt-0.5">
              best {streak.longestStreak}d
            </div>
          </div>
        )}
      </div>

      <StreakHeatmap completions={completions} />

      {streak && (
        <p className="text-[11px] text-muted leading-relaxed mt-3 tabular-nums">
          This week <span className="text-foreground font-medium">{streak.thisWeek}</span>
          {streak.graceUsedThisCycle && <> · <span className="text-warm">grace used</span></>}
        </p>
      )}

      <button
        onClick={() => (doneToday ? onUndo(today) : onComplete())}
        disabled={pending}
        aria-label={doneToday ? "Undo today's completion" : "Mark complete for today"}
        className={`mt-4 w-full flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2.5 border transition-colors duration-150 disabled:opacity-60 ${
          doneToday
            ? "bg-green text-white border-green hover:bg-green/90"
            : "bg-violet text-white border-violet hover:bg-violet/90"
        }`}
      >
        {pending ? (
          <Loader2 size={12} className="animate-spin" />
        ) : doneToday ? (
          <>
            <CheckCircle2 size={12} strokeWidth={2.25} />
            Done today
          </>
        ) : (
          <>
            <Circle size={12} strokeWidth={2.25} />
            Mark complete
          </>
        )}
      </button>
    </motion.div>
  );
}

/* ── 90-day streak heatmap ─────────────────────────────────── */

function StreakHeatmap({ completions }: { completions: CompletionEntry[] }) {
  const days = 91;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const set = new Set(completions.map((c) => c.date));

  const cells: { date: string; done: boolean; weekIdx: number; dayIdx: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const ms = today.getTime() - i * DAY;
    const d = new Date(ms);
    const iso = d.toISOString().slice(0, 10);
    cells.push({
      date: iso,
      done: set.has(iso),
      weekIdx: Math.floor((days - 1 - i) / 7),
      dayIdx: d.getDay(),
    });
  }

  return (
    <div className="flex gap-[3px]" aria-hidden>
      {Array.from({ length: 13 }).map((_, weekIdx) => (
        <div key={weekIdx} className="flex flex-col gap-[3px]">
          {Array.from({ length: 7 }).map((_, dayIdx) => {
            const cell = cells.find((c) => c.weekIdx === weekIdx && c.dayIdx === dayIdx);
            if (!cell) return <div key={dayIdx} className="w-[10px] h-[10px]" />;
            return (
              <div
                key={dayIdx}
                title={`${cell.date}: ${cell.done ? "completed" : "missed"}`}
                className={`w-[10px] h-[10px] ${cell.done ? "bg-green" : "bg-border-light"}`}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ── Rail: today's summary ─────────────────────────────────── */

function TodaySummary({
  dueToday, totalToday, totalStreak,
}: {
  dueToday: number;
  totalToday: number;
  totalStreak: number;
}) {
  const doneToday = totalToday - dueToday;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.06, ease }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
        <Target size={11} strokeWidth={1.75} />
        Today
      </p>
      <div className="border border-border bg-surface divide-y divide-border">
        <div className="flex items-start gap-3.5 px-4 py-3.5">
          <div className="mt-0.5 w-9 h-9 border border-border bg-background flex items-center justify-center shrink-0">
            <span className={`font-display font-bold tabular-nums text-[14px] tracking-tight ${doneToday > 0 ? "text-green" : "text-muted"}`}>
              {doneToday}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${doneToday > 0 ? "text-green" : "text-muted"}`}>
              Completed
            </div>
            <p className="text-[12px] text-muted leading-relaxed mt-0.5">
              {doneToday === 0 ? "Nothing logged yet today." : `${doneToday} of ${totalToday} habits done.`}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3.5 px-4 py-3.5">
          <div className="mt-0.5 w-9 h-9 border border-border bg-background flex items-center justify-center shrink-0">
            <span className={`font-display font-bold tabular-nums text-[14px] tracking-tight ${dueToday > 0 ? "text-warm" : "text-foreground"}`}>
              {dueToday}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <div className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${dueToday > 0 ? "text-warm" : "text-foreground"}`}>
              Still due
            </div>
            <p className="text-[12px] text-muted leading-relaxed mt-0.5">
              {dueToday === 0 ? "All habits completed for today." : "Mark each one once you've finished it."}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3.5 px-4 py-3.5">
          <div className="mt-0.5 w-9 h-9 border border-border bg-background flex items-center justify-center shrink-0">
            <Flame size={14} strokeWidth={2} className="text-warm" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-[0.15em] font-semibold text-warm">
              Cumulative streak
            </div>
            <p className="text-[12px] text-muted leading-relaxed mt-0.5 tabular-nums">
              {totalStreak} days across every habit combined.
            </p>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ── Rail: manifesto ───────────────────────────────────────── */

function ManifestoCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.14, ease }}
      className="border border-border bg-foreground text-background p-5 relative overflow-hidden"
    >
      <span aria-hidden className="absolute top-0 left-0 w-[2px] h-full bg-violet" />
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={12} strokeWidth={2} className="text-violet" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-background/60 font-medium">
          Streak protection
        </span>
      </div>
      <h3 className="font-display font-bold text-[18px] tracking-[-0.018em] leading-[1.2] mb-3">
        Skip one day. <span className="text-violet">Keep the streak</span>.
      </h3>
      <p className="text-[13px] text-background/70 leading-relaxed">
        Tempo grants one grace miss per cycle. Miss two in a row and the streak resets — but the next morning gets a make-up slot so you can recover.
      </p>
    </motion.div>
  );
}
