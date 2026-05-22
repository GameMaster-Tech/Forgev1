"use client";

/**
 * Preview — the Impact Simulator surface.
 *
 * The user proposes a hypothetical change ("move alpha target up by N
 * days", "raise senior salary by $5k", etc.). Forge forks the live
 * graph into an isolated, in-memory sandbox, cascades the delta
 * downstream, runs every saved rule, and returns a structured
 * **Delta Map** — exactly what would shift across timelines,
 * objectives, and task queues. Nothing touches the database until the
 * user clicks Accept.
 *
 * Single-statement layout (per the design brief):
 *   • A short prompt input at the top.
 *   • The Delta Map verdict + mutation timeline as the main column.
 *   • Accept / Discard at the bottom.
 *
 * Backed by the real `useForgeGraph` + `useImpactSimulator` hooks.
 */

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  Calendar as CalendarIcon,
  ListChecks,
  Layers,
  Loader2,
  X,
  Check,
} from "lucide-react";
import { useForgeGraph } from "@/hooks/useForgeGraph";
import { useImpactSimulator } from "@/hooks/useImpactSimulator";
import { useInvariants } from "@/hooks/useInvariants";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useSchedulerWorkspace } from "@/hooks/useSchedulerWorkspace";
import type { DeltaMutation, NodeId, VisualDeltaMap } from "@/lib/forge-graph";

const ease = [0.22, 0.61, 0.36, 1] as const;

export default function PreviewPage() {
  const { projectId } = useActiveProject();
  const { compiled: savedInvariants } = useInvariants({ projectId: projectId ?? "" });

  // Real per-project scheduler payload — events, tasks, habits, goals
  // come straight from /users/{uid}/projects/{pid}/scheduler_*. Empty
  // arrays when no project is active, so the picker stays empty and
  // the page renders its own empty state.
  const { payload: scheduler, loading, hydrated } = useSchedulerWorkspace(projectId);
  const graph = useForgeGraph({
    calendarEvents: scheduler.calendarEvents,
    goals: scheduler.goals,
    habits: scheduler.habits,
    tasks: scheduler.tasks,
    timedEvents: scheduler.events,
  });

  const { staged, simulating, accepting, acceptError, simulate, accept, reject } =
    useImpactSimulator({
      projectId: projectId ?? "",
      graph,
      invariants: savedInvariants,
    });

  // Loading hint while the live subscription warms up.
  void loading;

  const [daysShift, setDaysShift] = useState(2);
  const [targetId, setTargetId] = useState<NodeId | "">("");

  // Surface the user's scheduled events / goals as the simulation seed
  // set. We don't pre-select one — that's the user's first decision.
  const choices = useMemo(() => {
    const out: { id: NodeId; label: string; sub: string }[] = [];
    for (const node of graph.values()) {
      if (node.category !== "CALENDAR_EVENT" && node.category !== "GOAL") continue;
      const start = node.payload.metadata.startDate;
      const sub =
        start instanceof Date
          ? start.toLocaleDateString([], {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : node.category;
      out.push({ id: node.id, label: node.payload.title, sub });
    }
    return out.slice(0, 50);
  }, [graph]);

  const runSimulation = () => {
    if (!targetId) return;
    simulate(targetId, { daysShift });
  };

  return (
    <div className="min-h-full bg-background">
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="border-b border-border px-6 sm:px-10 pt-10 pb-6"
      >
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-2 flex items-center gap-2">
          <Sparkles size={11} strokeWidth={1.75} />
          Preview
        </p>
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
          See the cascade before you commit.
        </h1>
        <p className="text-[13px] text-muted mt-2 max-w-2xl leading-relaxed">
          Pick a date you might move, then see exactly which events, tasks, and
          goals would shift. Nothing touches your workspace until you accept.
        </p>
      </motion.header>

      <div className="max-w-4xl mx-auto px-6 sm:px-10 pt-8 pb-16">
        {!projectId ? (
          <div className="border border-dashed border-border bg-surface/40 p-10 text-center">
            <Sparkles size={18} strokeWidth={1.75} className="text-violet mx-auto mb-3" />
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-medium mb-2">
              Pick a project
            </p>
            <p className="text-[12.5px] text-muted leading-relaxed max-w-md mx-auto">
              Preview runs against a real project&apos;s events, tasks, and goals.
              Open a project from the sidebar first.
            </p>
          </div>
        ) : hydrated && choices.length === 0 ? (
          <div className="border border-dashed border-border bg-surface/40 p-10 text-center">
            <Sparkles size={18} strokeWidth={1.75} className="text-violet mx-auto mb-3" />
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-medium mb-2">
              Nothing to preview yet
            </p>
            <p className="text-[12.5px] text-muted leading-relaxed max-w-md mx-auto">
              Add at least one calendar event or goal to your project, then come back here to simulate a change.
            </p>
          </div>
        ) : (
        <>
        {/* ── Input ── */}
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease }}
          className="border border-border bg-surface p-5 mb-6"
        >
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
            Your hypothesis
          </p>
          <div className="flex flex-wrap items-center gap-3 text-[14px] text-foreground">
            <span>If I move</span>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="flex-1 min-w-[200px] bg-background border border-border focus:border-violet/50 outline-none px-3 py-2 text-[13px] transition-colors"
            >
              <option value="">— select an event or goal —</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label} · {c.sub}
                </option>
              ))}
            </select>
            <span>by</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setDaysShift((v) => v - 1)}
                className="w-7 h-9 border border-border bg-background hover:border-violet/50 text-foreground transition-colors"
              >
                –
              </button>
              <input
                type="number"
                value={daysShift}
                onChange={(e) => setDaysShift(Number(e.target.value))}
                className="w-16 text-center bg-background border-y border-border focus:border-violet/50 outline-none px-2 py-2 text-[13px] tabular-nums transition-colors"
              />
              <button
                type="button"
                onClick={() => setDaysShift((v) => v + 1)}
                className="w-7 h-9 border border-border bg-background hover:border-violet/50 text-foreground transition-colors"
              >
                +
              </button>
            </div>
            <span>day{Math.abs(daysShift) === 1 ? "" : "s"}, then…</span>
            <button
              type="button"
              onClick={runSimulation}
              disabled={!targetId || simulating}
              className="ml-auto flex items-center gap-2 bg-violet text-white hover:bg-violet/90 disabled:opacity-50 text-[11px] uppercase tracking-[0.12em] font-semibold px-4 py-2.5 transition-colors"
            >
              {simulating ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Sparkles size={12} strokeWidth={2.25} />
              )}
              Preview
            </button>
          </div>
        </motion.div>

        {/* ── Verdict + Delta Map ── */}
        <AnimatePresence mode="wait">
          {staged ? (
            <motion.div
              key="staged"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25, ease }}
            >
              <Verdict delta={staged.deltaMap} />
              <DeltaTimeline delta={staged.deltaMap} graph={graph} />
              <AcceptStrip
                viable={staged.deltaMap.isViable}
                accepting={accepting}
                error={acceptError}
                onAccept={() => void accept()}
                onDiscard={reject}
              />
            </motion.div>
          ) : (
            <EmptyState />
          )}
        </AnimatePresence>
        </>
        )}
      </div>
    </div>
  );
}

/* ───────────────────── verdict ───────────────────── */

function Verdict({ delta }: { delta: VisualDeltaMap }) {
  const passed = delta.isViable;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease }}
      className="border border-border bg-surface p-5 relative mb-6"
    >
      <span
        aria-hidden
        className={`absolute left-0 top-5 bottom-5 w-[2px] ${passed ? "bg-green" : "bg-rose"}`}
      />
      <div className="flex items-center gap-2 mb-2">
        {passed ? (
          <ShieldCheck size={11} strokeWidth={2} className="text-green" />
        ) : (
          <AlertTriangle size={11} strokeWidth={2} className="text-rose" />
        )}
        <span
          className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${passed ? "text-green" : "text-rose"}`}
        >
          {passed ? "Safe to apply" : "Blocks a rule"}
        </span>
        <span className="w-1 h-1 bg-muted rounded-full" />
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
          Risk score {delta.globalRiskScore}
        </span>
      </div>
      <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1]">
        {delta.mutations.length === 0 ? (
          <>Nothing would shift.</>
        ) : passed ? (
          <>
            {delta.mutations.length} item
            {delta.mutations.length === 1 ? "" : "s"} would{" "}
            <span className="text-violet">shift</span>.
          </>
        ) : (
          <>
            <span className="text-rose">{delta.assertionFailures.length}</span>{" "}
            rule{delta.assertionFailures.length === 1 ? "" : "s"} would break.
          </>
        )}
      </h2>

      {delta.assertionFailures.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {delta.assertionFailures.map((f) => (
            <li
              key={f.invariantId}
              className="text-[12px] text-rose leading-snug"
            >
              · {f.description}
              {f.suggestedFix ? (
                <span className="text-muted"> — {f.suggestedFix}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </motion.div>
  );
}

/* ───────────────────── delta timeline ───────────────────── */

function DeltaTimeline({
  delta,
  graph,
}: {
  delta: VisualDeltaMap;
  graph: Map<NodeId, { payload: { title: string }; category: string }>;
}) {
  if (delta.mutations.length === 0) return null;

  const groups = groupByNode(delta.mutations);
  return (
    <div className="border border-border bg-surface mb-6">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2">
        <Layers size={11} strokeWidth={2} className="text-violet" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-violet font-semibold">
          Delta map
        </span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted tabular-nums">
          · {groups.length} item{groups.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="divide-y divide-border">
        {groups.map((group, i) => {
          const node = graph.get(group.nodeId);
          const title = node?.payload.title ?? group.nodeId;
          const category = node?.category ?? "";
          const Icon =
            category === "CALENDAR_EVENT"
              ? CalendarIcon
              : category === "TASK"
                ? ListChecks
                : Layers;
          return (
            <motion.li
              key={group.nodeId}
              initial={{ opacity: 0, x: -6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{
                duration: 0.22,
                delay: Math.min(i, 12) * 0.04,
                ease,
              }}
              className="px-5 py-4 flex items-start gap-4"
            >
              <div className="w-8 h-8 border border-border bg-background flex items-center justify-center shrink-0">
                <Icon size={12} strokeWidth={1.75} className="text-violet" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-foreground font-medium truncate">
                  {title}
                </div>
                <div className="text-[10px] uppercase tracking-[0.12em] text-muted mt-0.5">
                  {category === "CALENDAR_EVENT"
                    ? "Event"
                    : category === "TASK"
                      ? "Task"
                      : category === "GOAL"
                        ? "Goal"
                        : category.toLowerCase()}
                </div>
                <ul className="mt-2 space-y-1">
                  {group.mutations.map((m, j) => (
                    <li
                      key={`${m.targetField}-${j}`}
                      className="text-[11.5px] text-muted tabular-nums leading-snug"
                    >
                      <span className="text-foreground/80">
                        {humanField(m.targetField)}
                      </span>{" "}
                      → {m.deltaMagnitude}
                    </li>
                  ))}
                </ul>
              </div>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

/* ───────────────────── accept strip ───────────────────── */

function AcceptStrip({
  viable,
  accepting,
  error,
  onAccept,
  onDiscard,
}: {
  viable: boolean;
  accepting: boolean;
  error: string | null;
  onAccept: () => void;
  onDiscard: () => void;
}) {
  return (
    <div className="border border-border bg-surface p-5">
      {error ? (
        <p className="text-[12px] text-rose mb-3 leading-relaxed">{error}</p>
      ) : null}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={onAccept}
          disabled={!viable || accepting}
          className="flex items-center gap-1.5 bg-violet text-white hover:bg-violet/90 disabled:opacity-50 text-[11px] uppercase tracking-[0.12em] font-semibold px-4 py-2.5 transition-colors"
        >
          {accepting ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Check size={12} strokeWidth={2.25} />
          )}
          Apply changes
        </button>
        <button
          type="button"
          onClick={onDiscard}
          disabled={accepting}
          className="flex items-center gap-1.5 border border-border text-foreground hover:border-rose hover:text-rose disabled:opacity-50 text-[11px] uppercase tracking-[0.12em] font-semibold px-4 py-2.5 transition-colors"
        >
          <X size={12} strokeWidth={2.25} />
          Discard
        </button>
        {!viable ? (
          <span className="ml-auto text-[10px] uppercase tracking-[0.12em] text-rose font-semibold">
            Fix the failing rules first
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ───────────────────── empty state ───────────────────── */

function EmptyState() {
  return (
    <div className="border border-dashed border-border bg-surface/40 p-10 text-center">
      <Sparkles
        size={18}
        strokeWidth={1.75}
        className="text-violet mx-auto mb-3"
      />
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted font-medium mb-2">
        No preview yet
      </p>
      <p className="text-[12.5px] text-muted leading-relaxed max-w-md mx-auto">
        Pick something from your calendar above, choose how far to move it,
        and Forge will trace the cascade across every connected item.
      </p>
    </div>
  );
}

/* ───────────────────── helpers ───────────────────── */

interface MutationGroup {
  nodeId: NodeId;
  mutations: DeltaMutation[];
}

function groupByNode(mutations: DeltaMutation[]): MutationGroup[] {
  const map = new Map<NodeId, DeltaMutation[]>();
  for (const m of mutations) {
    const arr = map.get(m.nodeId);
    if (arr) arr.push(m);
    else map.set(m.nodeId, [m]);
  }
  const out: MutationGroup[] = [];
  for (const [nodeId, list] of map.entries()) {
    out.push({ nodeId, mutations: list });
  }
  return out;
}

function humanField(field: string): string {
  if (field === "metadata.startDate") return "Start date";
  if (field === "metadata.endDate") return "End date";
  if (field === "metadata.durationHours") return "Duration";
  if (field === "title") return "Title";
  if (field === "content") return "Body";
  if (field.startsWith("metadata.")) return field.slice("metadata.".length);
  return field;
}
