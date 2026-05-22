"use client";

/**
 * Sync — Conflicts (list).
 *
 * Every unresolved violation in the workspace, displayed as a 2-col
 * grid of compact triage cards. The card surfaces severity,
 * magnitude, the conflict message in one line, and the variable
 * chips involved — without the full constraint debug. A hover-revealed
 * arrow links to /sync/conflicts/[constraintId] for the detail
 * page where the user can study one in peace.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  GitBranch,
  Layers,
  Lock,
  Sparkles,
  TrendingDown,
} from "lucide-react";
import type { Assertion, Violation } from "@/lib/sync";
import { useSync } from "../SyncProvider";
import { ease } from "../_components";

type Filter = "all" | "hard" | "soft";

export default function SyncConflictsListPage() {
  const { violations, assertionsById, computing, compile } = useSync();

  if (violations.length === 0) {
    return (
      <div className="max-w-4xl mx-auto px-6 sm:px-10 pt-10 pb-16">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-4">
          Clean
        </p>
        <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1] mb-4">
          Zero <span className="text-green">conflicts</span>.
        </h2>
        <p className="text-[14px] text-muted leading-relaxed mb-7 max-w-md">
          Every variable across every document satisfies every constraint. Recompile if you&apos;ve edited a value the solver should re-check.
        </p>
        <button
          onClick={compile}
          disabled={computing}
          className="inline-flex items-center gap-2 bg-violet text-white hover:bg-violet/90 disabled:opacity-60 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
        >
          <Sparkles size={12} strokeWidth={2.25} />
          Re-compile
          <ArrowRight size={12} strokeWidth={2} className="ml-1" />
        </button>
      </div>
    );
  }

  return <ConflictsListView violations={violations} assertions={assertionsById} />;
}

function ConflictsListView({
  violations, assertions,
}: {
  violations: Violation[];
  assertions: Map<string, Assertion>;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const hard = useMemo(() => violations.filter((v) => v.severity === "hard"), [violations]);
  const soft = useMemo(() => violations.filter((v) => v.severity !== "hard"), [violations]);

  // Sort: hard first, then by magnitude desc.
  const ordered = useMemo(() => {
    return [...violations].sort(
      (a, b) =>
        (a.severity === b.severity ? 0 : a.severity === "hard" ? -1 : 1) || b.magnitude - a.magnitude,
    );
  }, [violations]);

  const visible = useMemo(
    () => (filter === "all" ? ordered : ordered.filter((v) => (filter === "hard" ? v.severity === "hard" : v.severity !== "hard"))),
    [ordered, filter],
  );

  return (
    <div className="max-w-6xl mx-auto px-6 sm:px-10 pt-8 pb-16">
      <div className="flex items-end justify-between gap-3 mb-4 flex-wrap">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium flex items-center gap-2">
          <GitBranch size={11} strokeWidth={1.75} />
          {violations.length} unresolved · sorted by severity
        </p>
        <Link
          href="/sync/patch"
          prefetch
          className="text-[10px] uppercase tracking-[0.12em] font-semibold text-violet hover:underline inline-flex items-center gap-1.5"
        >
          See proposed patch
          <ArrowRight size={11} strokeWidth={2} />
        </Link>
      </div>

      <FilterChips
        filter={filter}
        onChange={setFilter}
        allCount={violations.length}
        hard={hard.length}
        soft={soft.length}
      />

      {visible.length === 0 ? (
        <FilterEmpty filter={filter} onReset={() => setFilter("all")} />
      ) : (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map((v, i) => (
            <ConflictSummaryCard
              key={v.constraintId}
              violation={v}
              assertions={assertions}
              order={i}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Summary card ──────────────────────────────────────────── */

function ConflictSummaryCard({
  violation, assertions, order,
}: {
  violation: Violation;
  assertions: Map<string, Assertion>;
  order: number;
}) {
  const isHard = violation.severity === "hard";
  const accent = isHard ? "bg-rose"  : "bg-warm";
  const tone   = isHard ? "text-rose" : "text-warm";
  const involved = violation.involved
    .map((id) => assertions.get(id))
    .filter((a): a is Assertion => !!a);

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(order, 12) * 0.035, ease }}
    >
      <Link
        href={`/sync/conflicts/${encodeURIComponent(violation.constraintId)}`}
        prefetch
        className="group block border border-border bg-surface p-5 relative forge-lift hover:border-violet/50 hover:bg-violet/[0.04] h-full"
      >
        <span aria-hidden className={`absolute left-0 top-5 bottom-5 w-[2px] ${accent}`} />

        {/* top row */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold ${tone}`}>
              <span aria-hidden className={`w-1.5 h-1.5 ${accent}`} />
              {isHard ? "Hard conflict" : "Soft warning"}
            </span>
            <span className="text-[10px] text-muted">·</span>
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums inline-flex items-center gap-1">
              <TrendingDown size={9} /> Δ {violation.magnitude.toLocaleString()}
            </span>
          </div>
          <ArrowRight
            size={14}
            strokeWidth={1.75}
            className="text-muted opacity-50 group-hover:opacity-100 group-hover:text-violet group-hover:translate-x-1 transition-all shrink-0 mt-0.5"
          />
        </div>

        {/* message */}
        <p className="text-[14px] sm:text-[15px] text-foreground leading-snug font-medium group-hover:text-violet transition-colors">
          {violation.message}
        </p>

        {/* involved variables */}
        {involved.length > 0 && (
          <div className="mt-4 pt-3 border-t border-border-light">
            <div className="flex items-center gap-x-2 gap-y-1.5 flex-wrap">
              <span className="text-[10px] uppercase tracking-[0.15em] text-muted font-medium">
                involves
              </span>
              {involved.slice(0, 4).map((a) => (
                <span
                  key={a.id}
                  className="text-[10px] uppercase tracking-[0.12em] text-foreground font-medium inline-flex items-center gap-1"
                >
                  {a.locked && <Lock size={9} className="text-violet" />}
                  {a.label}
                </span>
              ))}
              {involved.length > 4 && (
                <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium">
                  +{involved.length - 4}
                </span>
              )}
            </div>
          </div>
        )}
      </Link>
    </motion.div>
  );
}

/* ── Filter chips ──────────────────────────────────────────── */

function FilterChips({
  filter, onChange, allCount, hard, soft,
}: {
  filter: Filter;
  onChange: (f: Filter) => void;
  allCount: number;
  hard: number;
  soft: number;
}) {
  const chips: { key: Filter; label: string; count: number; dot: string }[] = [
    { key: "all",  label: "All",          count: allCount, dot: "bg-foreground" },
    { key: "hard", label: "Hard conflicts", count: hard,   dot: "bg-rose" },
    { key: "soft", label: "Soft warnings",  count: soft,   dot: "bg-warm" },
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
  const label = filter === "hard" ? "hard" : "soft";
  return (
    <div className="mt-8 border border-border bg-surface px-6 py-10 text-center">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        Empty filter
      </p>
      <h3 className="font-display font-bold text-foreground text-[20px] tracking-[-0.018em] mb-2">
        No <span className="text-violet">{label}</span> issues right now.
      </h3>
      <p className="text-[13px] text-muted leading-relaxed mb-5 max-w-md mx-auto">
        Switch back to &ldquo;All&rdquo; to see every violation Forge detected.
      </p>
      <button
        onClick={onReset}
        className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-violet hover:underline"
      >
        Back to all conflicts
        <ArrowRight size={11} strokeWidth={2} />
      </button>
    </div>
  );
}
