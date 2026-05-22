"use client";

/**
 * Sync — Patch change detail.
 *
 * One proposed change, in full. Big before → after in display type,
 * complete rationale, market reference, confidence bar, and prev/next
 * navigation across the changes in the current patch. The Apply /
 * Discard controls remain available so the user can act without
 * walking back to the patch index.
 */

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { ProposedChange } from "@/lib/sync";
import { useSync } from "../../SyncProvider";
import { describeValue, ease } from "../../_components";

export default function SyncPatchChangeDetailPage() {
  const params = useParams<{ assertionId: string }>();
  const { patch, applyCurrentPatch, discardPatch, assertionsById } = useSync();

  const targetId = useMemo(() => {
    const raw = params?.assertionId;
    if (!raw) return null;
    try { return decodeURIComponent(String(raw)); } catch { return String(raw); }
  }, [params]);

  if (!patch) {
    return (
      <div className="max-w-4xl mx-auto px-6 sm:px-10 pt-10 pb-16">
        <Link
          href="/sync/patch"
          prefetch
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground font-medium mb-6"
        >
          <ArrowLeft size={11} strokeWidth={2} />
          Back to patch
        </Link>
        <div className="border border-border bg-surface px-6 py-10 text-center">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
            No patch ready
          </p>
          <h3 className="font-display font-bold text-foreground text-[20px] tracking-[-0.018em] mb-2">
            Compile to <span className="text-violet">propose changes</span>.
          </h3>
          <p className="text-[13px] text-muted leading-relaxed mb-5 max-w-md mx-auto">
            There&apos;s no proposed patch in the workspace right now. Hit Compile to generate one.
          </p>
          <Link
            href="/sync/patch"
            prefetch
            className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-violet hover:underline"
          >
            Back to patch
            <ArrowRight size={11} strokeWidth={2} />
          </Link>
        </div>
      </div>
    );
  }

  const changes = patch.changes;
  const index = changes.findIndex((c) => c.assertionId === targetId);
  const change = index >= 0 ? changes[index] : null;
  const prev = index > 0 ? changes[index - 1] : null;
  const next = index >= 0 && index < changes.length - 1 ? changes[index + 1] : null;

  if (!change) {
    return (
      <div className="max-w-4xl mx-auto px-6 sm:px-10 pt-10 pb-16">
        <Link
          href="/sync/patch"
          prefetch
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground font-medium mb-6"
        >
          <ArrowLeft size={11} strokeWidth={2} />
          Back to patch
        </Link>
        <div className="border border-border bg-surface px-6 py-10 text-center">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
            Not in this patch
          </p>
          <h3 className="font-display font-bold text-foreground text-[20px] tracking-[-0.018em] mb-2">
            That variable isn&apos;t <span className="text-violet">in the current patch</span>.
          </h3>
          <p className="text-[13px] text-muted leading-relaxed mb-5 max-w-md mx-auto">
            A recompile may have shifted which variables the solver wants to move. Open the patch to see what&apos;s currently proposed.
          </p>
          <Link
            href="/sync/patch"
            prefetch
            className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-violet hover:underline"
          >
            Back to patch
            <ArrowRight size={11} strokeWidth={2} />
          </Link>
        </div>
      </div>
    );
  }

  const label = assertionsById.get(change.assertionId)?.label ?? change.assertionId;
  const confPct = Math.round(change.confidence * 100);

  return (
    <div className="max-w-5xl mx-auto px-6 sm:px-10 pt-8 pb-16">
      <Link
        href="/sync/patch"
        prefetch
        className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground font-medium mb-5"
      >
        <ArrowLeft size={11} strokeWidth={2} />
        All changes in patch
      </Link>

      <NavBar
        index={index}
        total={changes.length}
        prev={prev}
        next={next}
        assertionsById={assertionsById}
      />

      <motion.div
        key={change.assertionId}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease }}
        className="mt-6 border border-border bg-surface p-5 sm:p-7 relative"
      >
        <span aria-hidden className="absolute left-0 top-7 bottom-7 w-[2px] bg-violet" />

        <div className="flex items-center gap-2.5 mb-2 flex-wrap">
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold text-violet">
            <Sparkles size={11} strokeWidth={2} />
            Proposed change
          </span>
          <span className="w-1 h-1 bg-muted rounded-full" />
          <span className="text-[10px] uppercase tracking-[0.12em] text-violet font-semibold tabular-nums">
            {confPct}% confidence
          </span>
        </div>

        <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1]">
          {label}
        </h2>

        {/* before → after — display size */}
        <div className="mt-6 flex items-center gap-3 flex-wrap font-display font-bold text-[22px] sm:text-[28px] tracking-[-0.018em] tabular-nums leading-none">
          <span className="text-rose/80 line-through decoration-rose/60 decoration-[2px] px-3 py-2 border border-border bg-background">
            {describeValue(change.before)}
          </span>
          <ArrowRight size={20} className="text-muted" strokeWidth={1.5} />
          <span className="text-violet px-3 py-2 border border-violet bg-foreground">
            {describeValue(change.after)}
          </span>
        </div>

        {/* confidence bar */}
        <div className="mt-6">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] font-medium tabular-nums mb-1.5">
            <span className="text-muted">Solver confidence</span>
            <span className="text-violet">{confPct}%</span>
          </div>
          <div className="h-1.5 bg-border-light w-full overflow-hidden">
            <div className="h-full bg-violet" style={{ width: `${confPct}%` }} />
          </div>
        </div>

        {/* rationale */}
        <div className="mt-6 pt-5 border-t border-border-light">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-2">
            Rationale
          </p>
          <p className="text-[14px] text-foreground leading-relaxed">{change.rationale}</p>
        </div>

        {change.marketRef && (
          <div className="mt-5 pt-4 border-t border-border-light">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-2">
              Market reference
            </p>
            <div className="text-[12px] uppercase tracking-[0.14em] text-cyan font-medium inline-flex items-center gap-1.5">
              <Cpu size={11} /> {change.marketRef}
            </div>
          </div>
        )}

        {/* actions */}
        <div className="mt-6 pt-5 border-t border-border-light flex items-center gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium mr-2">
            Apply / discard the full patch:
          </span>
          <button
            onClick={applyCurrentPatch}
            className="flex items-center gap-2 bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
          >
            <CheckCircle2 size={12} strokeWidth={2.25} />
            Apply patch
          </button>
          <button
            onClick={discardPatch}
            className="flex items-center gap-2 border border-border text-foreground hover:border-rose hover:text-rose text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2.5 transition-colors duration-150"
          >
            <XCircle size={12} strokeWidth={2.25} />
            Discard
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/* ── Nav bar ───────────────────────────────────────────────── */

function NavBar({
  index, total, prev, next, assertionsById,
}: {
  index: number;
  total: number;
  prev: ProposedChange | null;
  next: ProposedChange | null;
  assertionsById: Map<string, { label: string }>;
}) {
  return (
    <div className="border border-border bg-surface flex items-stretch">
      <PrevNextButton direction="prev" change={prev} disabled={!prev} assertionsById={assertionsById} />
      <div className="flex-1 flex items-center justify-center px-4 py-3 border-x border-border">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium tabular-nums">
          #{String(index + 1).padStart(2, "0")} of {total}
        </span>
      </div>
      <PrevNextButton direction="next" change={next} disabled={!next} assertionsById={assertionsById} />
    </div>
  );
}

function PrevNextButton({
  direction, change, disabled, assertionsById,
}: {
  direction: "prev" | "next";
  change: ProposedChange | null;
  disabled: boolean;
  assertionsById: Map<string, { label: string }>;
}) {
  const isPrev = direction === "prev";
  if (disabled || !change) {
    return (
      <div className={`flex-1 min-w-0 px-4 py-3 flex items-center gap-2 text-muted/50 ${isPrev ? "justify-start" : "justify-end"}`}>
        {isPrev && <ChevronLeft size={12} strokeWidth={2} />}
        <span className="text-[10px] uppercase tracking-[0.12em] font-semibold">
          {isPrev ? "First in patch" : "Last in patch"}
        </span>
        {!isPrev && <ChevronRight size={12} strokeWidth={2} />}
      </div>
    );
  }
  const label = assertionsById.get(change.assertionId)?.label ?? change.assertionId;
  return (
    <Link
      href={`/sync/patch/${encodeURIComponent(change.assertionId)}`}
      prefetch
      className={`flex-1 min-w-0 px-4 py-3 flex items-center gap-2 text-foreground hover:bg-violet/[0.06] hover:text-violet transition-colors group ${isPrev ? "justify-start" : "justify-end"}`}
    >
      {isPrev && <ChevronLeft size={12} strokeWidth={2} className="group-hover:-translate-x-0.5 transition-transform" />}
      <div className={`min-w-0 ${isPrev ? "text-left" : "text-right"}`}>
        <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted group-hover:text-violet transition-colors">
          {isPrev ? "Prev" : "Next"}
        </div>
        <div className="text-[12px] font-medium text-foreground truncate">{label}</div>
      </div>
      {!isPrev && <ChevronRight size={12} strokeWidth={2} className="group-hover:translate-x-0.5 transition-transform" />}
    </Link>
  );
}
