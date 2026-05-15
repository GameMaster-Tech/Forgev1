"use client";

/**
 * HabitsPanel — list of habits with quick-complete + 90-day streak heatmap.
 *
 * Pure UI; data is passed in. The Calendar page wires this to either
 * demo data or live Firestore data via SWR/onSnapshot.
 */

import { motion } from "framer-motion";
import { CheckCircle2, Circle, Flame, Loader2, RotateCcw } from "lucide-react";
import { describeRRule, type Habit } from "@/lib/scheduler";
import type { CompletionEntry, StreakResult } from "@/lib/scheduler";

const ease = [0.22, 0.61, 0.36, 1] as const;
const DAY = 86_400_000;

interface Props {
  habits: Habit[];
  completionsByHabit: Map<string, CompletionEntry[]>;
  streaks: Map<string, StreakResult>;
  pendingHabitId: string | null;
  onComplete: (habitId: string) => void;
  onUndo: (habitId: string, date: string) => void;
}

export function HabitsPanel({ habits, completionsByHabit, streaks, pendingHabitId, onComplete, onUndo }: Props) {
  if (habits.length === 0) {
    return <div className="border border-border bg-surface py-12 text-center text-muted text-[13px]">No habits yet.</div>;
  }
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h2 className="font-display font-bold text-[22px] tracking-[-0.02em] text-foreground mb-2">Habits.</h2>
        <p className="text-[13px] text-muted leading-relaxed">Streaks are protected. Skip a day with grace; skip too many and Tempo carves a make-up slot for tomorrow morning.</p>
      </div>
      <ul className="space-y-5">
        {habits.filter((h) => !h.archivedAt).map((h) => (
          <HabitRow
            key={h.id}
            habit={h}
            completions={completionsByHabit.get(h.id) ?? []}
            streak={streaks.get(h.id)}
            pending={pendingHabitId === h.id}
            onComplete={() => onComplete(h.id)}
            onUndo={(date) => onUndo(h.id, date)}
          />
        ))}
      </ul>
    </div>
  );
}

function HabitRow({ habit, completions, streak, pending, onComplete, onUndo }: {
  habit: Habit;
  completions: CompletionEntry[];
  streak: StreakResult | undefined;
  pending: boolean;
  onComplete: () => void;
  onUndo: (date: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const doneToday = completions.some((c) => c.date === today);
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease }}
      className="border border-border bg-surface px-5 py-4"
    >
      <div className="flex items-start gap-4">
        <button
          onClick={() => (doneToday ? onUndo(today) : onComplete())}
          disabled={pending}
          aria-label={doneToday ? "Undo today" : "Mark complete"}
          className={`shrink-0 w-10 h-10 border flex items-center justify-center transition-colors duration-150 ${doneToday ? "bg-green text-white border-green" : "bg-background text-muted border-border hover:border-violet hover:text-violet"}`}
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : doneToday ? <CheckCircle2 size={14} strokeWidth={2.25} /> : <Circle size={14} strokeWidth={1.75} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <h3 className="font-display font-bold text-[16px] tracking-[-0.018em] text-foreground">{habit.title}</h3>
            <div className="flex items-center gap-3 text-[10px] uppercase tracking-[0.12em] font-medium tabular-nums">
              <span className="text-cyan">{describeRRule(habit.rrule)}</span>
              <span className="text-muted">·</span>
              <span className="text-muted">{habit.durationMinutes} min</span>
              {streak && (
                <>
                  <span className="text-muted">·</span>
                  <span className="inline-flex items-center gap-1 text-warm">
                    <Flame size={10} strokeWidth={2.25} /> {streak.streak}d
                  </span>
                </>
              )}
            </div>
          </div>
          {streak && (
            <p className="text-[11px] text-muted leading-relaxed mt-1">
              Longest streak <span className="tabular-nums">{streak.longestStreak}d</span> · This week <span className="tabular-nums">{streak.thisWeek}</span>
              {streak.graceUsedThisCycle && <> · <span className="text-warm">grace used</span></>}
            </p>
          )}
          <div className="mt-3">
            <StreakHeatmap completions={completions} />
          </div>
        </div>
      </div>
    </motion.li>
  );
}

/** 90-day streak heatmap — 13 cols × 7 rows. */
function StreakHeatmap({ completions }: { completions: CompletionEntry[] }) {
  const days = 91; // 13 weeks × 7 days
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
    <div className="flex gap-[3px]">
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

/** Small "reset all" button used by the parent when wired to live data. */
export function HabitsResetHint({ onReset }: { onReset: () => void }) {
  return (
    <button onClick={onReset} className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-violet inline-flex items-center gap-1.5">
      <RotateCcw size={10} /> Reset demo
    </button>
  );
}
