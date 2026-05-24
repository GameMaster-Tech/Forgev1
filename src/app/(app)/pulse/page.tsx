"use client";

/**
 * Pulse — Overview.
 *
 * 8/4 main+rail layout. Main hosts the featured "last reality-sync"
 * verdict card and a top-3 decay list (numbered, with mini trust
 * bars). Rail carries the state legend, the refactor-queue CTA, and
 * the principle manifesto. The dynamic header that used to live in
 * the layout now lives here as a featured card — matches the
 * /projects + /teams convention.
 */

import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Hourglass,
  Loader2,
  Sparkles,
} from "lucide-react";
import { usePulse } from "./PulseProvider";
import {
  PrincipleCard,
  PulseStateLegend,
  RefactorQueueCard,
  RunVerdictFeatured,
  TopDecayList,
  avgTrust,
} from "./_components";
import type { FreshnessItem } from "@/hooks/useFreshnessScan";

const ease = [0.22, 0.61, 0.36, 1] as const;

const CATEGORY_LABEL: Record<FreshnessItem["category"], string> = {
  dated: "Dated milestone",
  pricing: "Pricing",
  market: "Market snapshot",
  demographics: "Demographics",
  version: "Version pin",
  headcount: "Headcount",
  other: "Time-sensitive",
};

const SEVERITY_RING: Record<FreshnessItem["severity"], string> = {
  low: "border-muted/40 text-muted",
  medium: "border-warm/40 text-warm",
  high: "border-rose/40 text-rose",
};

export default function PulseOverviewPage() {
  const {
    run,
    snapshots,
    assertionMap,
    invalidatedCount,
    staleCount,
    freshCount,
    refactorsCount,
    aiFreshnessItems,
    aiScanning,
    aiLastScanAt,
    aiError,
  } = usePulse();

  const avgTrustPct = avgTrust(snapshots);

  return (
    <div className="grid grid-cols-12 gap-x-0">
      {/* ── Main column ────────────────────────────────────── */}
      <div className="col-span-12 lg:col-span-8 px-6 sm:px-10 pt-8 pb-16 lg:border-r lg:border-border">
        <RunVerdictFeatured
          run={run}
          invalidatedCount={invalidatedCount}
          staleCount={staleCount}
          freshCount={freshCount}
          refactorsCount={refactorsCount}
          avgTrustPct={avgTrustPct}
        />

        <div className="mt-10 pt-6 border-t border-border">
          <div className="flex items-end justify-between gap-4 mb-3 flex-wrap">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium flex items-center gap-2">
              <Hourglass size={11} strokeWidth={1.75} />
              Top decay · lowest trust
            </p>
            <Link
              href="/pulse/diffs"
              prefetch
              className="text-[10px] uppercase tracking-[0.12em] font-semibold text-violet hover:underline inline-flex items-center gap-1.5"
            >
              See all diffs
              <ArrowRight size={11} strokeWidth={2} />
            </Link>
          </div>
          <TopDecayList snapshots={snapshots} assertions={assertionMap} />
        </div>

        {/* AI freshness scan — runs on the SAME reality-sync click as
            the deterministic trust sweep above. Only renders once
            something's happened (scanning, error, or a previous run). */}
        <AIFreshnessSection
          scanning={aiScanning}
          items={aiFreshnessItems}
          lastScanAt={aiLastScanAt}
          error={aiError}
        />
      </div>

      {/* ── Right rail ─────────────────────────────────────── */}
      <aside className="col-span-12 lg:col-span-4 px-6 sm:px-10 pt-8 pb-16 space-y-6">
        <PulseStateLegend
          invalidated={invalidatedCount}
          stale={staleCount}
          fresh={freshCount}
          avgTrust={avgTrustPct}
        />
        <div>
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">
            Refactor queue
          </p>
          <RefactorQueueCard count={refactorsCount} />
        </div>
        <PrincipleCard />
      </aside>
    </div>
  );
}

/* ── AI freshness section ──────────────────────────────────── */

function AIFreshnessSection({
  scanning,
  items,
  lastScanAt,
  error,
}: {
  scanning: boolean;
  items: FreshnessItem[];
  lastScanAt: number | null;
  error: string | null;
}) {
  if (!scanning && lastScanAt == null && !error) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease }}
      className="mt-10 pt-6 border-t border-border"
    >
      <div className="flex items-end justify-between gap-3 mb-3 flex-wrap">
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium flex items-center gap-2">
          <Sparkles size={11} strokeWidth={1.75} className="text-cyan" />
          AI freshness check
        </p>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted tabular-nums">
          {scanning
            ? "running…"
            : lastScanAt != null
              ? `checked ${new Date(lastScanAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
              : ""}
        </span>
      </div>

      <AnimatePresence mode="wait">
        {scanning ? (
          <motion.div
            key="scanning"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex items-center gap-3 px-4 py-5 border border-border bg-surface text-[12px] text-muted"
          >
            <Loader2 size={14} className="text-cyan animate-spin" />
            Reading every doc and flagging time-sensitive claims…
          </motion.div>
        ) : error ? (
          <motion.div
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="px-4 py-4 border border-rose/30 bg-rose/[0.04] text-[12px] text-rose"
          >
            {error}
          </motion.div>
        ) : items.length === 0 ? (
          <motion.div
            key="clean"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="flex items-start gap-3 px-4 py-4 border border-border bg-surface"
          >
            <CheckCircle2 size={14} strokeWidth={2} className="text-green shrink-0 mt-0.5" />
            <div>
              <div className="font-display font-bold text-foreground text-[14px] tracking-[-0.014em]">
                Everything reads fresh.
              </div>
              <p className="text-[12px] text-muted mt-0.5 leading-relaxed">
                Nothing in your docs looks like it&apos;s aged out.
              </p>
            </div>
          </motion.div>
        ) : (
          <motion.ul
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="border border-border bg-surface divide-y divide-border"
          >
            {items.map((it, i) => (
              <motion.li
                key={`${it.docId}_${i}`}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, delay: i * 0.04, ease }}
                className="px-4 py-3.5"
              >
                <div className="flex items-start gap-3">
                  <div
                    className={`px-2 py-1 border text-[9px] uppercase tracking-[0.16em] font-semibold shrink-0 ${SEVERITY_RING[it.severity]}`}
                  >
                    {it.severity}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-[9px] uppercase tracking-[0.16em] font-semibold text-cyan inline-flex items-center gap-1">
                        <Clock size={9} strokeWidth={2} />
                        {CATEGORY_LABEL[it.category]}
                      </span>
                      <span className="text-[10px] uppercase tracking-[0.12em] text-muted">
                        {it.docTitle}
                      </span>
                    </div>
                    <p className="text-[12.5px] text-foreground/90 leading-snug mb-1">
                      &ldquo;{it.span}&rdquo;
                    </p>
                    {it.reason ? (
                      <p className="text-[11.5px] text-muted leading-relaxed">
                        {it.reason}
                      </p>
                    ) : null}
                  </div>
                </div>
              </motion.li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
