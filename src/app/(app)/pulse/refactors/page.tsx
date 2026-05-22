"use client";

/**
 * Pulse — Refactors (list).
 *
 * A queue of every pending refactor, displayed as a 2-column grid of
 * compact summary cards. Each card surfaces the metadata you need to
 * pick the right one to work on — kind, target block, triggering
 * assertions, and a one-line swap preview — without forcing the full
 * before/after content onto the page. Hovering reveals an arrow on
 * the right; clicking opens the dedicated detail page at
 * /pulse/refactors/[blockId] where the user can review and act in
 * isolation.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  FileText,
  Layers,
  Sparkles,
  Wand2,
} from "lucide-react";
import type { Assertion, AssertionId } from "@/lib/sync";
import type { RefactorProposal } from "@/lib/pulse";
import { usePulse } from "../PulseProvider";
import { describeValue, ease } from "../_components";

type Filter = "all" | "safe" | "review";

export default function PulseRefactorsListPage() {
  const { run, assertionMap } = usePulse();

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

  const all = run.refactorProposals;
  if (all.length === 0) return <EmptyState />;

  return <RefactorListView proposals={all} assertions={assertionMap} />;
}

/* ── List view ─────────────────────────────────────────────── */

function RefactorListView({
  proposals, assertions,
}: {
  proposals: RefactorProposal[];
  assertions: Map<AssertionId, Assertion>;
}) {
  const [filter, setFilter] = useState<Filter>("all");

  const safe   = useMemo(() => proposals.filter((p) => p.kind === "value-swap"),  [proposals]);
  const review = useMemo(() => proposals.filter((p) => p.kind !== "value-swap"),  [proposals]);

  const visible = filter === "safe" ? safe : filter === "review" ? review : proposals;

  return (
    <div className="max-w-6xl mx-auto px-6 sm:px-10 pt-8 pb-16">
      {/* header strip */}
      <div className="flex items-end justify-between gap-3 mb-4 flex-wrap">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium flex items-center gap-2">
          <FileText size={11} strokeWidth={1.75} />
          {proposals.length} refactor{proposals.length === 1 ? "" : "s"} pending review
        </p>
        <Link
          href="/pulse/diffs"
          prefetch
          className="text-[10px] uppercase tracking-[0.12em] font-semibold text-violet hover:underline inline-flex items-center gap-1.5"
        >
          See the source diffs
          <ArrowRight size={11} strokeWidth={2} />
        </Link>
      </div>

      <FilterChips
        filter={filter}
        onChange={setFilter}
        allCount={proposals.length}
        safeCount={safe.length}
        reviewCount={review.length}
      />

      {visible.length === 0 ? (
        <FilterEmpty filter={filter} onReset={() => setFilter("all")} />
      ) : (
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
          {visible.map((p, i) => (
            <RefactorSummaryCard
              key={`${p.blockId}::${p.triggeredBy.join(",")}`}
              proposal={p}
              index={proposals.indexOf(p) + 1}
              order={i}
              assertions={assertions}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Summary card (clickable link to detail page) ──────────── */

function RefactorSummaryCard({
  proposal, index, order, assertions,
}: {
  proposal: RefactorProposal;
  index: number;
  order: number;
  assertions: Map<AssertionId, Assertion>;
}) {
  const isSafe = proposal.kind === "value-swap";
  const triggers = proposal.triggeredBy
    .map((id) => assertions.get(id))
    .filter((a): a is Assertion => !!a);
  const lead = triggers[0];

  // Plain-English summary. Direct and specifies the requirement.
  //   "Update salary number — Levels.fyi median changed"
  //   "Rewrite paragraph — 2 sources moved"
  const summary = (() => {
    if (lead) {
      const verb = isSafe ? "Update" : "Rewrite";
      const what = isSafe ? `${lead.label.toLowerCase()}` : `paragraph`;
      const source = triggers.length === 1
        ? `${lead.label} changed`
        : `${triggers.length} sources moved`;
      return { verb, what, source };
    }
    return {
      verb: isSafe ? "Update" : "Rewrite",
      what: "block",
      source: "underlying data shifted",
    };
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(order, 10) * 0.04, ease }}
    >
      <Link
        href={`/pulse/refactors/${encodeURIComponent(proposal.blockId)}`}
        prefetch
        className="group block border border-border bg-surface p-5 relative forge-lift hover:border-violet/50 hover:bg-violet/[0.04] h-full"
      >
        <span
          aria-hidden
          className={`absolute left-0 top-5 bottom-5 w-[2px] ${isSafe ? "bg-violet" : "bg-warm"}`}
        />

        {/* index */}
        <div className="flex items-start justify-between gap-3 mb-2">
          <span className="font-display font-bold text-muted text-[12px] tabular-nums tracking-tight">
            #{String(index).padStart(2, "0")}
          </span>
          <ArrowRight
            size={14}
            strokeWidth={1.75}
            className="text-muted opacity-50 group-hover:opacity-100 group-hover:text-violet group-hover:translate-x-1 transition-all shrink-0 mt-0.5"
          />
        </div>

        {/* Plain English summary */}
        <h3 className="font-display font-bold text-foreground text-[17px] sm:text-[19px] tracking-[-0.018em] leading-tight group-hover:text-violet transition-colors">
          {summary.verb} {summary.what}.
        </h3>
        <p className="text-[12.5px] text-muted leading-relaxed mt-1.5">
          {summary.source.charAt(0).toUpperCase() + summary.source.slice(1)}.
        </p>

        {/* Footer — quiet attribution */}
        <div className="mt-4 pt-3 border-t border-border flex items-center justify-between gap-2 flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium">
            {proposal.documentId}
          </span>
          <span
            className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${isSafe ? "text-violet" : "text-warm"}`}
          >
            {isSafe ? "Safe swap" : "Needs review"}
          </span>
        </div>
      </Link>
    </motion.div>
  );
}

/* ── Filter chips ──────────────────────────────────────────── */

function FilterChips({
  filter, onChange, allCount, safeCount, reviewCount,
}: {
  filter: Filter;
  onChange: (f: Filter) => void;
  allCount: number;
  safeCount: number;
  reviewCount: number;
}) {
  const chips: { key: Filter; label: string; count: number; icon: typeof Layers }[] = [
    { key: "all",    label: "All",          count: allCount,    icon: Layers   },
    { key: "safe",   label: "Safe swap",    count: safeCount,   icon: Wand2    },
    { key: "review", label: "Needs review", count: reviewCount, icon: Sparkles },
  ];
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) => {
        const active = filter === c.key;
        const Icon = c.icon;
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
            <Icon size={11} strokeWidth={2} />
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

/* ── Empty state (no refactors at all) ─────────────────────── */

function EmptyState() {
  return (
    <div className="max-w-4xl mx-auto px-6 sm:px-10 pt-10 pb-16">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-4">
        Inbox zero
      </p>
      <h2 className="font-display font-bold text-foreground text-2xl sm:text-3xl tracking-[-0.022em] leading-[1.1] mb-4">
        Docs match the <span className="text-violet">workspace truth</span>.
      </h2>
      <p className="text-[14px] text-muted leading-relaxed mb-7 max-w-md">
        Nothing to rewrite. Every paragraph references a claim that&apos;s still inside its drift threshold.
      </p>
      <Link
        href="/pulse/diffs"
        prefetch
        className="inline-flex items-center gap-2 bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150"
      >
        <FileText size={12} strokeWidth={2.25} />
        See the diffs
        <ArrowRight size={12} strokeWidth={2} className="ml-1" />
      </Link>
    </div>
  );
}

/* ── Filter-empty (visible queue is empty for filter) ──────── */

function FilterEmpty({ filter, onReset }: { filter: Filter; onReset: () => void }) {
  const label = filter === "safe" ? "safe swap" : "needs-review";
  return (
    <div className="mt-8 border border-border bg-surface px-6 py-10 text-center">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
        Empty filter
      </p>
      <h3 className="font-display font-bold text-foreground text-[20px] tracking-[-0.018em] mb-2">
        No <span className="text-violet">{label}</span> refactors right now.
      </h3>
      <p className="text-[13px] text-muted leading-relaxed mb-5 max-w-md mx-auto">
        Switch back to &ldquo;All&rdquo; to see anything still waiting in the other category.
      </p>
      <button
        onClick={onReset}
        className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] font-semibold text-violet hover:underline"
      >
        Back to all refactors
        <ArrowRight size={11} strokeWidth={2} />
      </button>
    </div>
  );
}
