"use client";

/**
 * Shared primitives for the /pulse section.
 *
 * Underscore-prefixed so Next's route discovery skips it. Tight set:
 * value formatter, action chrome (cadence selector + sync button),
 * the featured run-verdict card, the principle manifesto, the
 * compact refactor-queue CTA, and the top-decay list used on the
 * overview page.
 */

import { motion } from "framer-motion";
import Link from "next/link";
import {
  ArrowRight,
  Clock,
  FileText,
  Hourglass,
  Loader2,
  Radio,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { Assertion, AssertionId } from "@/lib/sync";
import type { Cadence, SyncRun, TrustSnapshot } from "@/lib/pulse";

export const ease = [0.22, 0.61, 0.36, 1] as const;

/* ────────────── value formatter ────────────── */

export function describeValue(v: Assertion["value"] | null | undefined): string {
  if (!v) return "—";
  switch (v.type) {
    case "number":  return `${v.value.toLocaleString()}${v.unit ? " " + v.unit : ""}`;
    case "string":  return `"${v.value}"`;
    case "date":    return v.value;
    case "boolean": return v.value ? "true" : "false";
  }
}

export function avgTrust(snaps: TrustSnapshot[]): number {
  if (snaps.length === 0) return 0;
  const sum = snaps.reduce((acc, s) => acc + s.trust, 0);
  return Math.round((sum / snaps.length) * 100);
}

/* ────────────── header controls ────────────── */

const CADENCES: { key: Cadence; label: string }[] = [
  { key: "manual",  label: "Manual"  },
  { key: "daily",   label: "Daily"   },
  { key: "weekly",  label: "Weekly"  },
  { key: "monthly", label: "Monthly" },
];

export function CadenceSelect({
  cadence, onChange,
}: {
  cadence: Cadence;
  onChange: (c: Cadence) => void;
}) {
  return (
    <div className="flex items-center border border-border">
      {CADENCES.map((c) => (
        <button
          key={c.key}
          onClick={() => onChange(c.key)}
          className={`text-[10px] uppercase tracking-[0.12em] font-semibold px-3 h-9 transition-colors duration-150 ${cadence === c.key ? "bg-foreground text-background" : "bg-background text-muted hover:text-foreground"}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

export function SyncButton({ running, onClick }: { running: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={running}
      className="flex items-center gap-2 bg-violet text-white hover:bg-violet/90 disabled:opacity-60 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
    >
      {running ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} strokeWidth={2.25} />}
      Reality-sync
    </button>
  );
}

/* ────────────── overview pieces ────────────── */

/** Featured "last sync" verdict card — used at the top of /pulse. */
export function RunVerdictFeatured({
  run, invalidatedCount, staleCount, freshCount, refactorsCount, avgTrustPct,
}: {
  run: SyncRun | null;
  invalidatedCount: number;
  staleCount: number;
  freshCount: number;
  refactorsCount: number;
  avgTrustPct: number;
}) {
  const cleanState = run !== null && invalidatedCount === 0;
  const accent =
    invalidatedCount > 0 ? "bg-rose"
    : staleCount > 0     ? "bg-warm"
    : "bg-violet";

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        Last reality-sync
      </p>
      <div className="border border-border bg-surface p-5 sm:p-6 relative">
        <span aria-hidden className={`absolute left-0 top-5 bottom-5 w-[2px] ${accent}`} />
        <div className="flex items-center gap-2.5 mb-2 flex-wrap">
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold text-violet">
            <Radio size={11} strokeWidth={2} />
            {run ? run.cadence : "manual"} cadence
          </span>
          <span className="w-1 h-1 bg-muted rounded-full" />
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums flex items-center gap-1">
            <Clock size={10} />
            {run
              ? new Date(run.ranAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
              : "waiting for first run"}
          </span>
        </div>
        <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1]">
          {invalidatedCount > 0 ? (
            <>
              Reality drifted from{" "}
              <span className="text-rose">
                {invalidatedCount} {invalidatedCount === 1 ? "claim" : "claims"}
              </span>.
            </>
          ) : staleCount > 0 ? (
            <>Workspace is <span className="text-warm">aging</span>.</>
          ) : cleanState ? (
            <>Workspace matches <span className="text-violet">today</span>.</>
          ) : (
            <>Pulse <span className="text-violet">your project</span>.</>
          )}
        </h2>
        <p className="text-[13px] text-muted mt-3 leading-relaxed max-w-xl">
          {invalidatedCount > 0
            ? "The values you wrote down have drifted past their threshold. Pulse pre-wrote the swaps — open Refactors to ship them."
            : staleCount > 0
            ? "Trust has decayed on some claims but they're still within tolerance. Forge will refactor when they slip."
            : cleanState
            ? "Every tracked claim matches today's market reality. Trust readings are within tolerance."
            : "Re-check every claim in this project against today's reality. Drift past your threshold becomes a refactor."}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] uppercase tracking-[0.12em] text-muted tabular-nums font-medium">
          {invalidatedCount > 0 && (
            <span className="flex items-center gap-1.5 text-rose">
              <span aria-hidden className="w-1.5 h-1.5 bg-rose" />
              {invalidatedCount} invalidated
            </span>
          )}
          {staleCount > 0 && (
            <span className="flex items-center gap-1.5 text-warm">
              <span aria-hidden className="w-1.5 h-1.5 bg-warm" />
              {staleCount} stale
            </span>
          )}
          <span className="flex items-center gap-1.5 text-green">
            <span aria-hidden className="w-1.5 h-1.5 bg-green" />
            {freshCount} fresh
          </span>
          <span>avg trust {avgTrustPct}%</span>
          {refactorsCount > 0 && (
            <Link
              href="/pulse/refactors"
              prefetch
              className="ml-auto inline-flex items-center gap-1.5 text-violet hover:gap-2.5 transition-all"
            >
              {refactorsCount} refactor{refactorsCount === 1 ? "" : "s"} pending
              <ArrowRight size={12} strokeWidth={2} />
            </Link>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ────────────── top-decay list ────────────── */

export function TopDecayList({
  snapshots, assertions,
}: {
  snapshots: TrustSnapshot[];
  assertions: Map<AssertionId, Assertion>;
}) {
  const top = [...snapshots].sort((a, b) => a.trust - b.trust).slice(0, 3);
  return (
    <ul className="divide-y divide-border border-y border-border">
      {top.map((s, i) => {
        const a = assertions.get(s.assertionId);
        const pct = Math.round(s.trust * 100);
        const accentBar = s.trust < 0.4 ? "bg-rose" : s.trust < 0.7 ? "bg-warm" : "bg-green";
        const accentText = s.trust < 0.4 ? "text-rose" : s.trust < 0.7 ? "text-warm" : "text-green";
        return (
          <motion.li
            key={s.assertionId}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: i * 0.04, ease }}
          >
            <div className="grid grid-cols-12 items-start gap-x-4 sm:gap-x-6 py-4 -mx-3 px-3 sm:-mx-4 sm:px-4 hover:bg-violet/[0.06] transition-colors">
              <span className="col-span-1 font-display font-bold text-muted text-[13px] tabular-nums tracking-tight pt-0.5">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="col-span-8 sm:col-span-8 min-w-0">
                <h3 className="font-display font-bold text-foreground text-[15px] sm:text-[16px] tracking-[-0.018em] leading-tight truncate">
                  {a?.label ?? s.assertionId}
                </h3>
                <div className="mt-2 h-1 bg-border-light w-full overflow-hidden">
                  <div className={`h-full ${accentBar}`} style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium mt-1.5 tabular-nums">
                  {Math.round(s.ageDays)}d old · half-life {s.halfLifeDays}d
                </p>
              </div>
              <span className={`col-span-3 text-[11px] uppercase tracking-[0.12em] tabular-nums font-semibold justify-self-end pt-1 ${accentText}`}>
                {pct}%
              </span>
            </div>
          </motion.li>
        );
      })}
    </ul>
  );
}

/* ────────────── refactor queue CTA card ────────────── */

export function RefactorQueueCard({ count }: { count: number }) {
  if (count === 0) {
    return (
      <div className="border border-border bg-surface px-5 py-6">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 border border-border bg-background flex items-center justify-center shrink-0">
            <FileText size={12} className="text-muted" strokeWidth={1.75} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-[0.15em] text-muted font-semibold">
              No refactors
            </p>
            <p className="text-[12.5px] text-muted leading-relaxed mt-1">
              Documents match the workspace truth.
            </p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <Link
      href="/pulse/refactors"
      prefetch
      className="block border border-border bg-foreground text-background p-5 relative overflow-hidden group hover:bg-violet/95 transition-colors"
    >
      <span aria-hidden className="absolute left-0 top-0 w-[2px] h-full bg-violet" />
      <div className="flex items-center gap-2 mb-3">
        <FileText size={12} strokeWidth={2} className="text-violet" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-background/60 font-medium">
          Pending document rewrites
        </span>
      </div>
      <h3 className="font-display font-bold text-[20px] tracking-[-0.018em] leading-[1.15]">
        <span className="text-violet">{count}</span> block{count === 1 ? "" : "s"} need {count === 1 ? "a " : ""}refresh
      </h3>
      <p className="text-[12.5px] text-background/65 leading-relaxed mt-2">
        Paragraphs that reference invalidated claims. Pulse pre-wrote the swap.
      </p>
      <span className="mt-3 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] font-semibold text-violet group-hover:gap-2.5 transition-all">
        Open refactors
        <ArrowRight size={11} strokeWidth={2.25} />
      </span>
    </Link>
  );
}

/* ────────────── principle manifesto ────────────── */

export function PrincipleCard() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.18, ease }}
      className="border border-border bg-foreground text-background p-5 relative overflow-hidden"
    >
      <span aria-hidden className="absolute top-0 left-0 w-[2px] h-full bg-violet" />
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={12} strokeWidth={2} className="text-violet" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-background/60 font-medium">
          The principle
        </span>
      </div>
      <h3 className="font-display font-bold text-[18px] tracking-[-0.018em] leading-[1.2] mb-3">
        Facts decay. <span className="text-violet">Docs shouldn&apos;t lie.</span>
      </h3>
      <p className="text-[13px] text-background/70 leading-relaxed mb-4">
        A salary you wrote down nine months ago isn&apos;t the salary today. Pulse re-checks every claim against current reality and rewrites the prose so your docs stay honest.
      </p>
      <div className="flex items-center gap-1.5 text-[11px] text-background/55 font-medium">
        <Hourglass size={11} strokeWidth={1.75} />
        Trust decays · half-life per claim
      </div>
    </motion.div>
  );
}

/* ────────────── state-of-pulse legend ────────────── */

export function PulseStateLegend({
  invalidated, stale, fresh, avgTrust,
}: {
  invalidated: number;
  stale: number;
  fresh: number;
  avgTrust: number;
}) {
  const rows = [
    { label: "Invalidated", count: invalidated, accent: invalidated > 0 ? "text-rose"  : "text-muted", hint: "Past the drift threshold. Needs refactor." },
    { label: "Stale",       count: stale,       accent: stale > 0       ? "text-warm"  : "text-muted", hint: "Decaying. Within tolerance for now." },
    { label: "Fresh",       count: fresh,       accent: "text-green",                                  hint: "Matches today's reality." },
    { label: "Avg trust",   count: avgTrust,    accent: "text-foreground",                             hint: "Decayed-weighted across all claims (0-100)." },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.1, ease }}
    >
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        Current state
      </p>
      <div className="border border-border bg-surface divide-y divide-border">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start gap-3.5 px-4 py-3.5">
            <div className="mt-0.5 w-9 h-9 border border-border bg-background flex items-center justify-center shrink-0">
              <span className={`font-display font-bold tabular-nums text-[14px] tracking-tight ${r.accent}`}>{r.count}</span>
            </div>
            <div className="min-w-0 flex-1">
              <div className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${r.accent}`}>{r.label}</div>
              <p className="text-[12px] text-muted leading-relaxed mt-0.5">{r.hint}</p>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}
