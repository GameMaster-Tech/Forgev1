"use client";

/**
 * Calendar — Compiler / Invariants.
 *
 * Phase 4 Operational Invariant Asserter — UI engine.
 *
 * The page lets the user build a saved invariant array for the active
 * project. Each rule is evaluated against the *live* unified ForgeGraph
 * derived from current scheduler data (events + goals + habits +
 * tasks), giving immediate pass/fail feedback. The compiled rule set
 * is what `useImpactSimulator` consumes during the pre-merge
 * verification pipeline.
 */

import { useMemo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, ShieldCheck } from "lucide-react";

import { useCalendar } from "../../CalendarProvider";
import { useProjectsStore } from "@/store/projects";
import { useInvariants } from "@/hooks/useInvariants";
import { useForgeGraph } from "@/hooks/useForgeGraph";
import { InvariantList } from "@/components/forge-graph/InvariantList";
import { ease } from "../../_components";

export default function InvariantsPage() {
  const { scheduleBundle, allEvents } = useCalendar();
  const projects = useProjectsStore((s) => s.projects);

  // Pick the first active project for now; future PR will let the user
  // choose. The schedule data is project-agnostic in the demo so this
  // single-project assumption is reasonable.
  const projectId = projects[0]?.id ?? "demo-project";

  const { invariants, loading, error, addByKind, update, remove, compiled } =
    useInvariants({ projectId });

  // Build the unified graph from whatever the CalendarProvider already
  // has loaded — keeps this page deriviation-only.
  const graph = useForgeGraph({
    calendarEvents: allEvents,
    goals: scheduleBundle.goals,
    habits: scheduleBundle.habits,
    tasks: scheduleBundle.tasks,
    timedEvents: scheduleBundle.events,
  });

  const failing = useMemo(() => {
    if (!graph || compiled.length === 0) return 0;
    let n = 0;
    for (const inv of compiled) {
      try {
        if (!inv.evaluator(graph).passed) n += 1;
      } catch {
        n += 1;
      }
    }
    return n;
  }, [graph, compiled]);

  return (
    <div className="max-w-4xl mx-auto px-6 sm:px-10 pt-8 pb-16">
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
      >
        <Link
          href="/calendar/compiler"
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] font-medium text-muted hover:text-foreground mb-6"
        >
          <ArrowLeft size={11} strokeWidth={2} />
          Back to compiler
        </Link>

        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
          <ShieldCheck size={11} strokeWidth={1.75} />
          Rules
        </p>
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05] mb-3">
          Your <span className="text-violet">rules</span>.
        </h1>
        <p className="text-[13px] text-muted leading-relaxed max-w-2xl mb-8">
          Set guardrails that every "what if" simulation must pass. Hard rules
          stop a change from going through. Soft rules just raise a warning.
          {compiled.length > 0 ? (
            <>
              {" "}
              <span className="text-foreground font-semibold">
                {compiled.length} active
              </span>
              {failing > 0 ? (
                <>
                  {" · "}
                  <span className="text-rose font-semibold">{failing} failing</span>
                </>
              ) : null}
              .
            </>
          ) : null}
        </p>

        <InvariantList
          invariants={invariants}
          loading={loading}
          error={error}
          onAdd={addByKind}
          onUpdate={update}
          onRemove={remove}
          graph={graph}
        />
      </motion.div>
    </div>
  );
}
