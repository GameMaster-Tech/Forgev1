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
import { ArrowRight, Hourglass } from "lucide-react";
import { usePulse } from "./PulseProvider";
import {
  PrincipleCard,
  PulseStateLegend,
  RefactorQueueCard,
  RunVerdictFeatured,
  TopDecayList,
  avgTrust,
} from "./_components";

export default function PulseOverviewPage() {
  const {
    run,
    snapshots,
    assertionMap,
    invalidatedCount,
    staleCount,
    freshCount,
    refactorsCount,
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
