"use client";

/**
 * GoalsPanel — goal list with progress + Tempo's proposed goal-blocks.
 */

import { motion } from "framer-motion";
import { Target, ArrowRight, Pin, CheckCircle2 } from "lucide-react";
import type { Goal, GoalBlock, PlanResult } from "@/lib/scheduler";

const ease = [0.22, 0.61, 0.36, 1] as const;

interface Props {
  goals: Goal[];
  plan: PlanResult | null;
  onCommitBlock?: (blockId: string) => void;
}

export function GoalsPanel({ goals, plan, onCommitBlock }: Props) {
  if (goals.length === 0) {
    return <div className="border border-border bg-surface py-12 text-center text-muted text-[13px]">No goals yet.</div>;
  }
  const blocksByGoal = new Map<string, GoalBlock[]>();
  for (const b of plan?.newBlocks ?? []) {
    if (b.kind !== "goal-block") continue;
    const arr = blocksByGoal.get(b.goalId) ?? [];
    arr.push(b);
    blocksByGoal.set(b.goalId, arr);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h2 className="font-display font-bold text-[22px] tracking-[-0.02em] text-foreground mb-2">Goals.</h2>
        <p className="text-[13px] text-muted leading-relaxed">First-class scheduling primitives. Tempo distributes deficit-proportional time pulls across your week and explains each placement.</p>
      </div>
      <ul className="space-y-6">
        {goals.filter((g) => g.status === "active").map((g) => (
          <motion.li
            key={g.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease }}
            className="border border-border bg-surface px-5 py-4"
          >
            <div className="flex items-start gap-4">
              <div className="shrink-0 w-10 h-10 border border-border bg-background flex items-center justify-center">
                <Target size={14} className="text-violet" strokeWidth={2} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                  <h3 className="font-display font-bold text-[17px] tracking-[-0.018em] text-foreground">{g.title}</h3>
                  {g.targetDate && (
                    <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
                      target {new Date(g.targetDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  )}
                </div>
                {g.description && <p className="text-[12.5px] text-muted leading-relaxed mt-1">{g.description}</p>}
                <ProgressBar logged={g.loggedMinutes} target={g.weeklyMinutesTarget} />
                <ProposedBlocks blocks={blocksByGoal.get(g.id) ?? []} onCommit={onCommitBlock} />
              </div>
            </div>
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function ProgressBar({ logged, target }: { logged: number; target: number }) {
  const pct = target === 0 ? 0 : Math.min(100, Math.round((logged / target) * 100));
  const tone = pct >= 100 ? "bg-green" : pct >= 60 ? "bg-violet" : pct >= 30 ? "bg-warm" : "bg-rose";
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] font-medium tabular-nums">
        <span className="text-muted">Weekly progress</span>
        <span className="text-foreground">{Math.round(logged / 60 * 10) / 10}h / {Math.round(target / 60 * 10) / 10}h · <span className="text-violet">{pct}%</span></span>
      </div>
      <div className="h-1.5 bg-border-light w-full overflow-hidden mt-1">
        <div className={`h-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function ProposedBlocks({ blocks, onCommit }: { blocks: GoalBlock[]; onCommit?: (id: string) => void }) {
  if (blocks.length === 0) {
    return <p className="text-[11px] text-muted leading-relaxed mt-3">No goal-blocks proposed this week — Tempo finds nothing under-filled.</p>;
  }
  return (
    <div className="mt-4">
      <div className="text-[10px] uppercase tracking-[0.15em] text-muted font-semibold mb-2 flex items-center gap-1.5">
        <Pin size={10} /> Proposed pulls — {blocks.length}
      </div>
      <ul className="border border-border bg-background divide-y divide-border">
        {blocks.map((b) => (
          <li key={b.id} className="px-4 py-3 flex items-start gap-3">
            <span className="w-1 h-9 bg-violet shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-[10px] uppercase tracking-[0.12em] text-violet font-semibold mb-0.5">
                {b.energy} · {b.durationMinutes} min
              </div>
              <div className="text-[12.5px] text-foreground font-medium">
                {new Date(b.start).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })}
                <ArrowRight size={10} className="inline mx-1.5 text-muted" />
                {new Date(b.end).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </div>
              {b.placementRationale && b.placementRationale.length > 0 && (
                <p className="text-[11px] text-muted leading-relaxed mt-1">{b.placementRationale.join(" · ")}</p>
              )}
            </div>
            {onCommit && (
              <button
                onClick={() => onCommit(b.id)}
                className="border border-border w-7 h-7 flex items-center justify-center text-muted hover:text-green hover:border-green transition-colors"
                aria-label="Commit block"
              >
                <CheckCircle2 size={11} />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
