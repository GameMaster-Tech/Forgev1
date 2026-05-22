"use client";

/**
 * Pulse — Diff detail.
 *
 * One claim, in full. Shows the workspace value, today's reality
 * value, the blended-oracle contributions when present, and a trust
 * bar — plus prev/next nav across the diff list (sorted by severity
 * + drift, matching the list page's order).
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
  Hourglass,
  Lock,
  Radio,
  Sparkles,
  TrendingDown,
} from "lucide-react";
import type { Assertion } from "@/lib/sync";
import type { OracleContribution, RealityDiff } from "@/lib/pulse";

type DiffStatus = RealityDiff["status"];
import { usePulse } from "../../PulseProvider";
import { describeValue, ease } from "../../_components";

export default function PulseDiffDetailPage() {
  const params = useParams<{ assertionId: string }>();
  const { run, assertionMap } = usePulse();

  const targetId = useMemo(() => {
    const raw = params?.assertionId;
    if (!raw) return null;
    try { return decodeURIComponent(String(raw)); } catch { return String(raw); }
  }, [params]);

  // Sort matches the list-page ordering so prev/next walks in the
  // same sequence the user sees there.
  const ordered = useMemo(() => {
    return [...(run?.diffs ?? [])].sort(
      (a, b) => statusWeight(b.status) - statusWeight(a.status) || b.driftRatio - a.driftRatio,
    );
  }, [run]);

  const index = useMemo(
    () => ordered.findIndex((d) => d.assertionId === targetId),
    [ordered, targetId],
  );
  const diff = index >= 0 ? ordered[index] : null;
  const prev = index > 0 ? ordered[index - 1] : null;
  const next = index >= 0 && index < ordered.length - 1 ? ordered[index + 1] : null;

  if (!run) {
    return (
      <div className="max-w-4xl mx-auto px-6 sm:px-10 pt-10 pb-16">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-4">
          Hydrating
        </p>
        <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1]">
          Running first <span className="text-violet">sync</span>…
        </h2>
      </div>
    );
  }

  if (!diff) {
    return (
      <div className="max-w-4xl mx-auto px-6 sm:px-10 pt-10 pb-16">
        <Link
          href="/pulse/diffs"
          prefetch
          className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground font-medium mb-6"
        >
          <ArrowLeft size={11} strokeWidth={2} />
          Back to diffs
        </Link>
        <div className="border border-border bg-surface px-6 py-10 text-center">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
            Not found
          </p>
          <h3 className="font-display font-bold text-foreground text-[20px] tracking-[-0.018em] mb-2">
            That claim isn&apos;t in <span className="text-violet">this run</span>.
          </h3>
          <p className="text-[13px] text-muted leading-relaxed mb-5 max-w-md mx-auto">
            Pulse may have re-checked a different set of assertions since this URL was generated. Open the queue to see the current set.
          </p>
          <Link
            href="/pulse/diffs"
            prefetch
            className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-violet hover:underline"
          >
            Back to the diffs
            <ArrowRight size={11} strokeWidth={2} />
          </Link>
        </div>
      </div>
    );
  }

  const assertion = assertionMap.get(diff.assertionId);
  const accent = diff.status === "invalidated" ? "bg-rose" : diff.status === "stale" ? "bg-warm" : "bg-green";
  const tone   = diff.status === "invalidated" ? "text-rose" : diff.status === "stale" ? "text-warm" : "text-green";
  const trustPct = Math.round(diff.trustBefore * 100);

  return (
    <div className="max-w-5xl mx-auto px-6 sm:px-10 pt-8 pb-16">
      <Link
        href="/pulse/diffs"
        prefetch
        className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-muted hover:text-foreground font-medium mb-5"
      >
        <ArrowLeft size={11} strokeWidth={2} />
        All diffs
      </Link>

      <NavBar index={index} total={ordered.length} prev={prev} next={next} />

      <motion.div
        key={diff.assertionId}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease }}
        className="mt-6 border border-border bg-surface p-5 sm:p-7 relative"
      >
        <span aria-hidden className={`absolute left-0 top-7 bottom-7 w-[2px] ${accent}`} />

        {/* badges */}
        <div className="flex items-center gap-2.5 mb-2 flex-wrap">
          <span className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold ${tone}`}>
            <Radio size={11} strokeWidth={2} />
            {diff.status}
          </span>
          <span className="w-1 h-1 bg-muted rounded-full" />
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
            drift {(diff.driftRatio * 100).toFixed(1)}%
          </span>
          <span className="w-1 h-1 bg-muted rounded-full" />
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums inline-flex items-center gap-1">
            <Hourglass size={9} /> trust {trustPct}%
          </span>
          {assertion?.locked && (
            <>
              <span className="w-1 h-1 bg-muted rounded-full" />
              <span className="text-[10px] uppercase tracking-[0.12em] text-violet font-medium inline-flex items-center gap-1">
                <Lock size={9} /> locked
              </span>
            </>
          )}
        </div>

        {/* title */}
        <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1]">
          {assertion?.label ?? diff.assertionId}
        </h2>
        <p className="text-[13px] text-muted mt-3 leading-relaxed max-w-2xl">{diff.message}</p>

        {/* trust bar */}
        <div className="mt-5">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] font-medium tabular-nums mb-1.5">
            <span className="text-muted">Trust at comparison</span>
            <span className={tone}>{trustPct}%</span>
          </div>
          <div className="h-1.5 bg-border-light w-full overflow-hidden">
            <div className={`h-full ${accent}`} style={{ width: `${trustPct}%` }} />
          </div>
        </div>

        {/* swap */}
        <div className="mt-6 flex items-center gap-3 flex-wrap font-display font-bold tracking-[-0.018em] tabular-nums">
          <span className="border border-border bg-background px-3 py-1.5 text-muted text-[14px] sm:text-[15px]">
            workspace · {describeValue(diff.workspaceValue)}
          </span>
          <TrendingDown size={14} className="text-muted" />
          <span
            className={`border px-3 py-1.5 text-[14px] sm:text-[15px] ${
              diff.status === "invalidated" ? "border-rose bg-foreground text-background" : "border-border bg-background text-foreground"
            }`}
          >
            reality · {describeValue(diff.realityValue)}
          </span>
          {diff.realityAsOf && (
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
              as of {diff.realityAsOf}
            </span>
          )}
        </div>

        {/* contributions */}
        {diff.contributions && diff.contributions.length > 0 && (
          <Contributions contributions={diff.contributions} />
        )}

        {/* CTA → refactors */}
        <div className="mt-6 pt-5 border-t border-border-light flex items-center gap-3 flex-wrap">
          <Link
            href="/pulse/refactors"
            prefetch
            className="inline-flex items-center gap-2 bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
          >
            <Sparkles size={12} strokeWidth={2.25} />
            See proposed refactors
          </Link>
          {assertion && (
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium">
              kind · {assertion.kind}
            </span>
          )}
          {diff.realitySource && (
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium truncate">
              source · {diff.realitySource}
            </span>
          )}
        </div>
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
  prev: RealityDiff | null;
  next: RealityDiff | null;
}) {
  return (
    <div className="border border-border bg-surface flex items-stretch">
      <PrevNextButton direction="prev" diff={prev} disabled={!prev} />
      <div className="flex-1 flex items-center justify-center px-4 py-3 border-x border-border">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium tabular-nums">
          #{String(index + 1).padStart(2, "0")} of {total}
        </span>
      </div>
      <PrevNextButton direction="next" diff={next} disabled={!next} />
    </div>
  );
}

function PrevNextButton({
  direction, diff, disabled,
}: {
  direction: "prev" | "next";
  diff: RealityDiff | null;
  disabled: boolean;
}) {
  const isPrev = direction === "prev";
  if (disabled || !diff) {
    return (
      <div className={`flex-1 min-w-0 px-4 py-3 flex items-center gap-2 text-muted/50 ${isPrev ? "justify-start" : "justify-end"}`}>
        {isPrev && <ChevronLeft size={12} strokeWidth={2} />}
        <span className="text-[10px] uppercase tracking-[0.12em] font-semibold">
          {isPrev ? "First in list" : "Last in list"}
        </span>
        {!isPrev && <ChevronRight size={12} strokeWidth={2} />}
      </div>
    );
  }
  return (
    <Link
      href={`/pulse/diffs/${encodeURIComponent(diff.assertionId)}`}
      prefetch
      className={`flex-1 min-w-0 px-4 py-3 flex items-center gap-2 text-foreground hover:bg-violet/[0.06] hover:text-violet transition-colors group ${isPrev ? "justify-start" : "justify-end"}`}
    >
      {isPrev && <ChevronLeft size={12} strokeWidth={2} className="group-hover:-translate-x-0.5 transition-transform" />}
      <div className={`min-w-0 ${isPrev ? "text-left" : "text-right"}`}>
        <div className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted group-hover:text-violet transition-colors">
          {isPrev ? "Prev" : "Next"}
        </div>
        <div className="text-[12px] font-medium text-foreground truncate">{diff.assertionId}</div>
      </div>
      {!isPrev && <ChevronRight size={12} strokeWidth={2} className="group-hover:translate-x-0.5 transition-transform" />}
    </Link>
  );
}

/* ── contributions ─────────────────────────────────────────── */

function Contributions({ contributions }: { contributions: OracleContribution[] }) {
  const total = contributions.reduce((acc, c) => acc + Math.max(0, c.priority), 0);
  return (
    <div className="mt-5 border-l-2 border-cyan/40 pl-4 space-y-1.5">
      <p className="text-[10px] uppercase tracking-[0.15em] text-cyan font-semibold">
        {contributions.length} oracle{contributions.length === 1 ? "" : "s"} · blended
      </p>
      {contributions.map((c) => {
        const share = total > 0 ? (c.priority / total) * 100 : 100 / contributions.length;
        return (
          <div key={c.oracleId} className="text-[11.5px] text-muted flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-foreground">{c.oracleName}</span>
            <span className="text-cyan tabular-nums">×{c.priority}</span>
            <span className="tabular-nums">{share.toFixed(0)}% weight</span>
            <span className="text-muted">· {describeValue(c.reading.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────────── */

function statusWeight(s: DiffStatus): number {
  return s === "invalidated" ? 2 : s === "stale" ? 1 : 0;
}
