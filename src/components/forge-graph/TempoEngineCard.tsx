"use client";

/**
 * TempoEngineCard — surfaces the Forge Reactive Workspace AdvancedTempoEngine
 * directly on the /calendar/tempo page.
 *
 * Shows the most recent accepted Tempo run (cascade shifts,
 * multi-bookings resolved, gap compactions) with a link to the
 * scenario it ran on. Pure presentation; data comes from
 * /api/forge-graph/tempo/runs via useTempoRuns.
 */

import { motion } from "framer-motion";
import {
  GitBranch,
  Layers,
  AlertTriangle,
  Hourglass,
  Sparkles,
  Loader2,
} from "lucide-react";
import { useTempoRuns } from "@/hooks/useTempoRuns";

const EASE = [0.22, 0.61, 0.36, 1] as const;

export function TempoEngineCard({ projectId }: { projectId: string }) {
  const { runs, loading, error } = useTempoRuns(projectId);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className="border border-border bg-surface p-5 relative"
    >
      <span aria-hidden className="absolute left-0 top-5 bottom-5 w-[2px] bg-violet" />
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={11} strokeWidth={2} className="text-violet" />
        <span className="text-[10px] uppercase tracking-[0.18em] font-semibold text-violet">
          Tempo engine
        </span>
        <span className="text-[10px] text-muted">·</span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
          accepted runs
        </span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-muted py-4">
          <Loader2 size={12} className="animate-spin text-violet" />
          Loading runs…
        </div>
      ) : error ? (
        <p className="text-[12px] text-rose">{error}</p>
      ) : runs.length === 0 ? (
        <div>
          <p className="text-[13px] text-foreground leading-relaxed">
            No runs yet.
          </p>
          <p className="text-[12px] text-muted mt-1.5 leading-relaxed max-w-md">
            When you accept a &ldquo;what if&rdquo; simulation on the Compiler page,
            Tempo shifts dependent events, resolves overlapping meetings, and
            closes gaps. Each accepted change shows up here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {runs.slice(0, 5).map((run) => {
            const r = run.report;
            return (
              <li
                key={run.id}
                className="border-t border-border pt-3 first:border-t-0 first:pt-0"
              >
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <GitBranch
                    size={10}
                    strokeWidth={2}
                    className="text-violet shrink-0"
                  />
                  <span className="text-[11px] text-foreground font-medium truncate max-w-xs">
                    {run.scenario}
                  </span>
                  <span className="text-[10px] text-muted">·</span>
                  <span className="text-[10px] uppercase tracking-[0.12em] text-muted tabular-nums">
                    {new Date(run.createdAt).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-[0.12em] text-muted tabular-nums font-medium ml-4">
                  <span className="flex items-center gap-1 text-violet">
                    <Layers size={10} strokeWidth={2} />
                    {r.cascadeShifts.length} shifted
                  </span>
                  <span
                    className={`flex items-center gap-1 ${r.multiBookings.length > 0 ? "text-warm" : "text-muted"}`}
                  >
                    <AlertTriangle size={10} strokeWidth={2} />
                    {r.multiBookings.length} double-book{r.multiBookings.length === 1 ? "" : "s"} fixed
                  </span>
                  <span
                    className={`flex items-center gap-1 ${r.compactions.length > 0 ? "text-green" : "text-muted"}`}
                  >
                    <Hourglass size={10} strokeWidth={2} />
                    {r.compactions.length} gap{r.compactions.length === 1 ? "" : "s"} closed
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </motion.div>
  );
}
