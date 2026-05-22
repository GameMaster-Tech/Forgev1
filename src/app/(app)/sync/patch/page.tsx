"use client";

/**
 * Sync — Patch.
 *
 * The patch verdict + apply / discard controls stay top-of-page (the
 * patch is applied as a single atomic unit, so this remains the
 * primary action). The per-change breakdown below is a 2-column grid
 * of compact summary cards instead of a slab list — each card hover-
 * reveals an arrow and links to /sync/patch/[assertionId] where the
 * user can study the rationale, market reference, and confidence in
 * isolation.
 */

import Link from "next/link";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Cpu,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { LogicalPatch, ProposedChange } from "@/lib/sync";
import { useSync } from "../SyncProvider";
import { describeValue, ease } from "../_components";

export default function SyncPatchPage() {
  const { patch, computing, compile, applyCurrentPatch, discardPatch, assertionsById } = useSync();

  if (!patch) {
    return (
      <div className="max-w-4xl mx-auto px-6 sm:px-10 pt-10 pb-16">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-4">
          No patch ready
        </p>
        <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1] mb-4">
          Compile to <span className="text-violet">propose a patch</span>.
        </h2>
        <p className="text-[14px] text-muted leading-relaxed mb-7 max-w-md">
          The solver walks every constraint in the workspace and reaches a stable assignment. Locked values stay locked; flexible variables move to satisfy the rules.
        </p>
        <button
          onClick={compile}
          disabled={computing}
          className="inline-flex items-center gap-2 bg-violet text-white hover:bg-violet/90 disabled:opacity-60 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
        >
          <Sparkles size={12} strokeWidth={2.25} />
          Compile workspace
          <ArrowRight size={12} strokeWidth={2} className="ml-1" />
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-6 sm:px-10 pt-8 pb-16">
      <PatchVerdict patch={patch} onApply={applyCurrentPatch} onDiscard={discardPatch} />

      <div className="mt-10 pt-6 border-t border-border">
        <div className="flex items-end justify-between gap-3 mb-4 flex-wrap">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium">
            Per-change breakdown · {patch.changes.length} variable{patch.changes.length === 1 ? "" : "s"}
          </p>
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium">
            click any change to study in detail
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {patch.changes.map((c, i) => (
            <ChangeSummaryCard
              key={c.assertionId}
              change={c}
              index={i + 1}
              order={i}
              label={assertionsById.get(c.assertionId)?.label ?? c.assertionId}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Patch verdict (top of page) ───────────────────────────── */

function PatchVerdict({
  patch, onApply, onDiscard,
}: {
  patch: LogicalPatch;
  onApply: () => void;
  onDiscard: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        Proposed patch
      </p>
      <div className="border border-border bg-surface p-5 sm:p-6 relative">
        <span aria-hidden className="absolute left-0 top-5 bottom-5 w-[2px] bg-violet" />
        <div className="flex items-center gap-2.5 mb-2 flex-wrap">
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold text-violet">
            <Sparkles size={11} strokeWidth={2} />
            {patch.changes.length} change{patch.changes.length === 1 ? "" : "s"}
          </span>
          <span className="w-1 h-1 bg-muted rounded-full" />
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
            {patch.iterations} iteration{patch.iterations === 1 ? "" : "s"}
          </span>
          <span className="w-1 h-1 bg-muted rounded-full" />
          {patch.reachesStableState ? (
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-green font-semibold">
              <CheckCircle2 size={10} /> Reaches stable
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-[0.12em] text-warm font-semibold">
              <AlertTriangle size={10} /> Partial
            </span>
          )}
        </div>
        <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1]">
          Apply to drive the workspace to a <span className="text-violet">stable state</span>.
        </h2>
        <p className="text-[13.5px] text-muted leading-relaxed mt-3 max-w-2xl">{patch.summary}</p>

        <div className="mt-6 flex items-center gap-2 flex-wrap">
          <button
            onClick={onApply}
            className="flex items-center gap-2 bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
          >
            <CheckCircle2 size={12} strokeWidth={2.25} />
            Apply patch
          </button>
          <button
            onClick={onDiscard}
            className="flex items-center gap-2 border border-border text-foreground hover:border-rose hover:text-rose text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2.5 transition-colors duration-150"
          >
            <XCircle size={12} strokeWidth={2.25} />
            Discard
          </button>
          <Link
            href="/sync/conflicts"
            prefetch
            className="ml-auto text-[10px] uppercase tracking-[0.12em] font-semibold text-violet hover:underline inline-flex items-center gap-1.5"
          >
            View conflicts
            <ArrowRight size={11} strokeWidth={2} />
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

/* ── Per-change summary card (link to detail) ──────────────── */

function ChangeSummaryCard({
  change, index, order, label,
}: {
  change: ProposedChange;
  index: number;
  order: number;
  label: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(order, 12) * 0.035, ease }}
    >
      <Link
        href={`/sync/patch/${encodeURIComponent(change.assertionId)}`}
        prefetch
        className="group block border border-border bg-surface p-5 relative forge-lift hover:border-violet/50 hover:bg-violet/[0.04] h-full"
      >
        <span aria-hidden className="absolute left-0 top-5 bottom-5 w-[2px] bg-violet" />

        {/* top row */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="font-display font-bold text-muted text-[12px] tabular-nums tracking-tight">
              #{String(index).padStart(2, "0")}
            </span>
            <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-violet inline-flex items-center gap-1">
              <Sparkles size={10} strokeWidth={2.25} />
              {(change.confidence * 100).toFixed(0)}% conf
            </span>
          </div>
          <ArrowRight
            size={14}
            strokeWidth={1.75}
            className="text-muted opacity-50 group-hover:opacity-100 group-hover:text-violet group-hover:translate-x-1 transition-all shrink-0 mt-0.5"
          />
        </div>

        {/* variable label */}
        <h3 className="font-display font-bold text-foreground text-[16px] sm:text-[18px] tracking-[-0.018em] leading-tight group-hover:text-violet transition-colors">
          {label}
        </h3>

        {/* before → after */}
        <div className="mt-4 flex items-center gap-2 flex-wrap text-[12px] sm:text-[13px] tabular-nums font-display font-bold tracking-[-0.018em]">
          <span className="text-rose/80 line-through decoration-rose/60 decoration-[1.5px]">
            {describeValue(change.before)}
          </span>
          <ArrowRight size={12} className="text-muted shrink-0" strokeWidth={1.75} />
          <span className="text-violet">
            {describeValue(change.after)}
          </span>
        </div>

        {/* short rationale + market ref */}
        <p className="text-[11.5px] text-muted leading-relaxed mt-3 line-clamp-2">
          {change.rationale}
        </p>
        {change.marketRef && (
          <div className="mt-2 text-[10px] uppercase tracking-[0.14em] text-cyan font-medium inline-flex items-center gap-1.5 truncate">
            <Cpu size={9} /> {change.marketRef}
          </div>
        )}
      </Link>
    </motion.div>
  );
}
