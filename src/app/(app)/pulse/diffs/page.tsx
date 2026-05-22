"use client";

/**
 * Pulse — Diffs (list).
 *
 * Every claim Pulse re-checked against today's reality, displayed as
 * a 2-column grid of compact summary cards. The card shows enough
 * metadata to triage (status, drift %, trust %, the workspace
 * value, locked indicator) without dumping the full reality
 * source / contributions onto the list. Hovering reveals a right
 * arrow; clicking opens /pulse/diffs/[assertionId] for the full
 * detail in peace.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Hourglass,
  Layers,
  Lock,
  Radio,
  TrendingDown,
} from "lucide-react";
import type { Assertion, AssertionId } from "@/lib/sync";
import type { RealityDiff } from "@/lib/pulse";

type DiffStatus = RealityDiff["status"];
import { usePulse } from "../PulseProvider";
import { describeValue, ease } from "../_components";

type Filter = "all" | "invalidated" | "stale" | "fresh";

export default function PulseDiffsListPage() {
  const { run, assertionMap, invalidatedCount, staleCount, freshCount } = usePulse();

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

  return (
    <DiffListView
      diffs={run.diffs}
      assertions={assertionMap}
      invalidated={invalidatedCount}
      stale={staleCount}
      fresh={freshCount}
    />
  );
}

function DiffListView({
  diffs, assertions, invalidated, stale, fresh,
}: {
  diffs: RealityDiff[];
  assertions: Map<AssertionId, Assertion>;
  invalidated: number;
  stale: number;
  fresh: number;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  // Sort by severity then drift so the most pressing claims rank
  // first in the visible grid — independent of the underlying run
  // ordering.
  const ordered = useMemo(() => {
    return [...diffs].sort(
      (a, b) => statusWeight(b.status) - statusWeight(a.status) || b.driftRatio - a.driftRatio,
    );
  }, [diffs]);

  const visible = useMemo(
    () => (filter === "all" ? ordered : ordered.filter((d) => d.status === filter)),
    [ordered, filter],
  );

  return (
    <div className="max-w-6xl mx-auto px-6 sm:px-10 pt-8 pb-16">
      <div className="flex items-end justify-between gap-3 mb-4 flex-wrap">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium flex items-center gap-2">
          <Radio size={11} strokeWidth={1.75} />
          Reality-diff · {diffs.length} claim{diffs.length === 1 ? "" : "s"} checked
        </p>
        <Link
          href="/pulse/refactors"
          prefetch
          className="text-[10px] uppercase tracking-[0.12em] font-semibold text-violet hover:underline inline-flex items-center gap-1.5"
        >
          See refactors
          <ArrowRight size={11} strokeWidth={2} />
        </Link>
      </div>

      <FilterChips
        filter={filter}
        onChange={setFilter}
        allCount={diffs.length}
        invalidated={invalidated}
        stale={stale}
        fresh={fresh}
      />

      {visible.length === 0 ? (
        <FilterEmpty filter={filter} onReset={() => setFilter("all")} />
      ) : (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map((d, i) => (
            <DiffSummaryCard
              key={d.assertionId}
              diff={d}
              assertion={assertions.get(d.assertionId)}
              order={i}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Summary card (link to detail page) ────────────────────── */

function DiffSummaryCard({
  diff, assertion, order,
}: {
  diff: RealityDiff;
  assertion?: Assertion;
  order: number;
}) {
  const accent = diff.status === "invalidated" ? "bg-rose"   : diff.status === "stale" ? "bg-warm"   : "bg-green";
  const tone   = diff.status === "invalidated" ? "text-rose" : diff.status === "stale" ? "text-warm" : "text-green";
  const trustPct = Math.round(diff.trustBefore * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(order, 12) * 0.035, ease }}
    >
      <Link
        href={`/pulse/diffs/${encodeURIComponent(diff.assertionId)}`}
        prefetch
        className="group block border border-border bg-surface p-5 relative forge-lift hover:border-violet/50 hover:bg-violet/[0.04] h-full"
      >
        <span aria-hidden className={`absolute left-0 top-5 bottom-5 w-[2px] ${accent}`} />

        {/* top row: status + arrow */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold ${tone}`}>
              <span aria-hidden className={`w-1.5 h-1.5 ${accent}`} />
              {diff.status}
            </span>
            <span className="text-[10px] text-muted">·</span>
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums inline-flex items-center gap-1">
              <TrendingDown size={9} /> {(diff.driftRatio * 100).toFixed(1)}% drift
            </span>
          </div>
          <ArrowRight
            size={14}
            strokeWidth={1.75}
            className="text-muted opacity-50 group-hover:opacity-100 group-hover:text-violet group-hover:translate-x-1 transition-all shrink-0 mt-0.5"
          />
        </div>

        {/* assertion label */}
        <h3 className="font-display font-bold text-foreground text-[17px] sm:text-[19px] tracking-[-0.018em] leading-tight group-hover:text-violet transition-colors flex items-center gap-2">
          {assertion?.label ?? diff.assertionId}
          {assertion?.locked && <Lock size={11} className="text-violet shrink-0" strokeWidth={2} />}
        </h3>

        {/* trust bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.12em] font-medium tabular-nums mb-1">
            <span className="text-muted inline-flex items-center gap-1">
              <Hourglass size={9} /> trust
            </span>
            <span className={tone}>{trustPct}%</span>
          </div>
          <div className="h-1 bg-border-light w-full overflow-hidden">
            <div className={`h-full ${accent}`} style={{ width: `${trustPct}%` }} />
          </div>
        </div>

        {/* compact swap preview */}
        <div className="mt-4 pt-3 border-t border-border-light flex items-center gap-2 flex-wrap text-[11px] tabular-nums">
          <span className="border border-border bg-background px-2 py-1 text-muted truncate max-w-[40%]">
            workspace · {describeValue(diff.workspaceValue)}
          </span>
          <TrendingDown size={11} className="text-muted shrink-0" />
          <span
            className={`border px-2 py-1 truncate max-w-[40%] ${
              diff.status === "invalidated" ? "border-rose bg-foreground text-background" : "border-border bg-background text-foreground"
            }`}
          >
            reality · {describeValue(diff.realityValue)}
          </span>
        </div>
      </Link>
    </motion.div>
  );
}

/* ── Filter chips ──────────────────────────────────────────── */

function FilterChips({
  filter, onChange, allCount, invalidated, stale, fresh,
}: {
  filter: Filter;
  onChange: (f: Filter) => void;
  allCount: number;
  invalidated: number;
  stale: number;
  fresh: number;
}) {
  const chips: { key: Filter; label: string; count: number; dot: string }[] = [
    { key: "all",         label: "All",         count: allCount,    dot: "bg-foreground" },
    { key: "invalidated", label: "Invalidated", count: invalidated, dot: "bg-rose" },
    { key: "stale",       label: "Stale",       count: stale,       dot: "bg-warm" },
    { key: "fresh",       label: "Fresh",       count: fresh,       dot: "bg-green" },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => {
        const active = filter === c.key;
        return (
          <button
            key={c.key}
            onClick={() => onChange(c.key)}
            disabled={c.count === 0}
            className={`flex items-center gap-2 px-3 h-9 text-[10px] uppercase tracking-[0.12em] font-semibold transition-colors duration-150 border disabled:opacity-40 disabled:cursor-not-allowed ${
              active
                ? "bg-foreground text-background border-foreground"
                : "bg-background text-muted hover:text-foreground hover:border-violet border-border"
            }`}
          >
            {c.key === "all" ? <Layers size={11} strokeWidth={2} /> : <span aria-hidden className={`w-1.5 h-1.5 ${c.dot}`} />}
            {c.label}
            <span className={`tabular-nums ${active ? "text-background/65" : "text-muted"}`}>
              {c.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ── Filter-empty ──────────────────────────────────────────── */

function FilterEmpty({ filter, onReset }: { filter: Filter; onReset: () => void }) {
  return (
    <div className="mt-8 border border-border bg-surface px-6 py-10 text-center">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        Empty filter
      </p>
      <h3 className="font-display font-bold text-foreground text-[20px] tracking-[-0.018em] mb-2">
        No <span className="text-violet">{filter}</span> claims this run.
      </h3>
      <p className="text-[13px] text-muted leading-relaxed mb-5 max-w-md mx-auto">
        Switch back to &ldquo;All&rdquo; to see every claim Pulse checked.
      </p>
      <button
        onClick={onReset}
        className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-violet hover:underline"
      >
        Back to all diffs
        <ArrowRight size={11} strokeWidth={2} />
      </button>
    </div>
  );
}

/* ── helpers ───────────────────────────────────────────────── */

function statusWeight(s: DiffStatus): number {
  return s === "invalidated" ? 2 : s === "stale" ? 1 : 0;
}
