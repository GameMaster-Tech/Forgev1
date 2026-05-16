"use client";

/**
 * Pulse — temporal entropy dashboard.
 *
 * Layout:
 *   • Header with hero verdict, cadence selector, sync button, stats.
 *   • Editorial sub-nav (Overview / Diffs / Refactors) under the header.
 *   • Tab content panel — overview privileges hierarchy (one verdict +
 *     stats + top-3 list); detail tabs render the heavy content.
 */

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Activity,
  AlertTriangle,
  Clock,
  Hourglass,
  Loader2,
  RefreshCw,
  Radio,
  TrendingDown,
  FileText,
  Lock,
  ArrowRight,
} from "lucide-react";
import { buildDemoGraph } from "@/lib/sync";
import type { Assertion, AssertionId } from "@/lib/sync";
import {
  buildDemoBlocks,
  defaultConfig,
  defaultRegistry,
  filterRejected,
  pruneRejections,
  rejectionKeyOf,
  REJECTION_TTL_MS,
  runSync,
  snapshot as trustSnapshot,
  type Cadence,
  type ContentBlock,
  type OracleContribution,
  type PulseConfig,
  type RealityDiff,
  type RefactorProposal,
  type SyncRun,
  type TrustSnapshot,
} from "@/lib/pulse";
import { RefactorReview } from "@/components/pulse/RefactorReview";
import { useRegisterCommandSource, makeCommandId, type CommandItem } from "@/hooks/useCommandPalette";

const ease = [0.22, 0.61, 0.36, 1] as const;

const CADENCES: { key: Cadence; label: string }[] = [
  { key: "manual",  label: "Manual"  },
  { key: "daily",   label: "Daily"   },
  { key: "weekly",  label: "Weekly"  },
  { key: "monthly", label: "Monthly" },
];

type Tab = "overview" | "diffs" | "refactors";
const TABS: { key: Tab; label: string }[] = [
  { key: "overview",  label: "Overview"  },
  { key: "diffs",     label: "Diffs"     },
  { key: "refactors", label: "Refactors" },
];

export default function PulsePage() {
  const [graph] = useState(() => buildDemoGraph());
  // Blocks live in state so accepting a refactor mutates the rendered
  // document body. The blocks array is the source of truth for the
  // Pulse run input.
  const [blocks, setBlocks] = useState<ContentBlock[]>(() => buildDemoBlocks());
  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<SyncRun | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  // Map of rejection-key → expiresAt (ms epoch). Persisted across
  // re-runs so the same proposal doesn't reappear within the TTL.
  const [rejections, setRejections] = useState<Map<string, number>>(() => new Map());

  const assertions = useMemo(() => graph.listAssertions(), [graph]);
  const assertionMap = useMemo(
    () => new Map<AssertionId, Assertion>(assertions.map((a) => [a.id, a] as const)),
    [assertions],
  );
  const snapshots = useMemo<TrustSnapshot[]>(
    () => assertions.map((a) => trustSnapshot(a)),
    [assertions],
  );

  // Sweep expired rejections each render so stale entries don't pile up.
  useEffect(() => {
    setRejections((prev) => {
      const pruned = pruneRejections(prev);
      return pruned.size === prev.size ? prev : pruned;
    });
  }, [run]);

  const handleRun = async () => {
    setRunning(true);
    const config: Partial<PulseConfig> = { ...defaultConfig(graph.projectId), cadence };
    const registry = defaultRegistry(2026);
    const next = await runSync({ assertions, blocks, oracle: registry, config });
    next.refactorProposals = filterRejected(next.refactorProposals, rejections);
    setRun(next);
    setRunning(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const registry = defaultRegistry(2026);
      const next = await runSync({
        assertions: graph.listAssertions(),
        blocks,
        oracle: registry,
        config: { ...defaultConfig(graph.projectId), cadence: "weekly" },
      });
      if (cancelled) return;
      next.refactorProposals = filterRejected(next.refactorProposals, rejections);
      setRun(next);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, blocks]);

  const handleAccept = async (proposal: RefactorProposal) => {
    // 1) Persist the new body into the in-page blocks state. This
    //    immediately mutates the rendered document.
    setBlocks((prev) => prev.map((b) => (b.id === proposal.blockId ? { ...b, body: proposal.after } : b)));
    // 2) Remove the proposal from the current run so the queue updates.
    setRun((prev) => (prev ? {
      ...prev,
      refactorProposals: prev.refactorProposals.filter((p) => p.blockId !== proposal.blockId || rejectionKeyOf(p) !== rejectionKeyOf(proposal)),
    } : prev));
    // 3) Fire the persist API in the background — best-effort. The UI
    //    doesn't block on it, but errors are surfaced via console for
    //    QA + observability.
    try {
      await fetch("/api/pulse/refactor/accept", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: graph.projectId,
          blockId: proposal.blockId,
          documentId: proposal.documentId,
          body: proposal.after,
          triggeredBy: proposal.triggeredBy,
          kind: proposal.kind,
        }),
      });
    } catch (err) {
      console.warn("[pulse] accept persist failed (non-fatal):", err);
    }
  };

  const handleReject = async (proposal: RefactorProposal) => {
    const key = rejectionKeyOf(proposal);
    const expiresAt = Date.now() + REJECTION_TTL_MS;
    setRejections((prev) => {
      const next = new Map(prev);
      next.set(key, expiresAt);
      return next;
    });
    setRun((prev) => (prev ? {
      ...prev,
      refactorProposals: prev.refactorProposals.filter((p) => rejectionKeyOf(p) !== key),
    } : prev));
    try {
      await fetch("/api/pulse/refactor/reject", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: graph.projectId,
          blockId: proposal.blockId,
          documentId: proposal.documentId,
          triggeredBy: proposal.triggeredBy,
        }),
      });
    } catch (err) {
      console.warn("[pulse] reject persist failed (non-fatal):", err);
    }
  };

  const handleSkip = (proposal: RefactorProposal) => {
    // Skip = leave the proposal in the queue. We just remove it from
    // the *current* run's list so the user sees their action; the
    // next Pulse run will re-emit it.
    setRun((prev) => (prev ? {
      ...prev,
      refactorProposals: prev.refactorProposals.filter((p) => p !== proposal),
    } : prev));
  };

  const invalidated = run ? run.diffs.filter((d) => d.status === "invalidated") : [];
  const stale       = run ? run.diffs.filter((d) => d.status === "stale") : [];
  const fresh       = run ? run.diffs.filter((d) => d.status === "fresh") : [];

  // Surface refactor proposals in the command palette.
  const refactorCommands = useMemo<CommandItem[]>(() => {
    if (!run) return [];
    return run.refactorProposals.map((p) => {
      const a = p.triggeredBy.map((id) => assertionMap.get(id)).filter(Boolean) as Assertion[];
      return {
        id: makeCommandId("pulse.refactor", `${p.blockId}_${p.triggeredBy.join(",")}`),
        kind: "refactor" as const,
        label: `Refactor ${p.blockId}`,
        subtitle: `${p.kind === "value-swap" ? "Safe swap" : "Needs review"} · ${a.map((x) => x.label).join(", ")}`,
        keywords: a.flatMap((x) => [x.label, x.key, x.documentId]),
        href: "/pulse",
        anchor: `refactor-${p.blockId}`,
      };
    });
  }, [run, assertionMap]);
  useRegisterCommandSource("pulse.refactors", refactorCommands);

  return (
    <div className="min-h-full bg-background">
      {/* ───────── Header ───────── */}
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="px-6 sm:px-10 pt-10 pb-6 flex flex-col gap-6"
      >
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="max-w-2xl">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-2 flex items-center gap-2">
              <Activity size={11} strokeWidth={1.75} />
              Pulse · reality-sync
            </p>
            <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
              {invalidated.length > 0
                ? <>Reality drifted from <span className="text-rose">{invalidated.length} {invalidated.length === 1 ? "claim" : "claims"}</span>.</>
                : stale.length > 0
                ? <>Workspace is <span className="text-warm">aging</span>.</>
                : run
                ? <>Workspace matches <span className="text-violet">today</span>.</>
                : <>Pulse <span className="text-violet">your project</span>.</>
              }
            </h1>
            <p className="text-[13px] text-muted mt-3 leading-relaxed">
              Every claim has a half-life. Pulse runs a Reality-Diff against today&apos;s market data, invalidates anything past the drift threshold, and rewrites the affected paragraphs.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <CadenceSelect cadence={cadence} onChange={setCadence} />
            <button
              onClick={handleRun}
              disabled={running}
              className="flex items-center gap-2 bg-violet text-white hover:bg-violet/90 disabled:opacity-60 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150 btn-glow-violet"
            >
              {running ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} strokeWidth={2.25} />}
              Reality-sync now
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Invalidated" value={invalidated.length} hint="needs refactor" tone={invalidated.length > 0 ? "rose" : "green"} />
          <Stat label="Stale"       value={stale.length}       hint="drifting"        tone={stale.length > 0 ? "warm" : "green"} />
          <Stat label="Fresh"       value={fresh.length}       hint="within tolerance" tone="green" />
          <Stat label="Avg trust"   value={avgTrust(snapshots)} hint="0–100, decayed"  tone="cyan" suffix="%" />
        </div>
      </motion.header>

      {/* ───────── Sub-nav ───────── */}
      <div className="border-y border-border bg-background sticky top-0 z-10">
        <div className="px-6 sm:px-10 flex items-center">
          {TABS.map((t) => {
            const active = tab === t.key;
            const count =
              t.key === "diffs"     ? (run?.diffs.length ?? 0) :
              t.key === "refactors" ? (run?.refactorProposals.length ?? 0) : null;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative text-[11px] uppercase tracking-[0.14em] font-semibold px-4 py-3 transition-colors duration-150 ${active ? "text-foreground" : "text-muted hover:text-foreground"}`}
              >
                <span className="inline-flex items-center gap-2">
                  {t.label}
                  {count !== null && (
                    <span className={`text-[10px] tabular-nums px-1.5 py-0.5 ${active ? "bg-violet text-white" : "bg-surface-light text-muted"}`}>
                      {count}
                    </span>
                  )}
                </span>
                {active && (
                  <motion.span
                    layoutId="pulse-tab-indicator"
                    transition={{ duration: 0.22, ease }}
                    className="absolute left-0 right-0 -bottom-px h-[2px] bg-violet"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ───────── Tab content ───────── */}
      <div className="px-6 sm:px-10 pt-8 pb-16">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease }}
          >
            {tab === "overview"  && <OverviewPanel run={run} snapshots={snapshots} assertions={assertionMap} onJumpToDiffs={() => setTab("diffs")} onJumpToRefactors={() => setTab("refactors")} />}
            {tab === "diffs"     && <DiffsPanel run={run} assertions={assertionMap} />}
            {tab === "refactors" && (
              <RefactorsPanel
                run={run}
                assertions={assertionMap}
                onAccept={handleAccept}
                onReject={handleReject}
                onSkip={handleSkip}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ─────── Overview panel ─────── */

function OverviewPanel({
  run, snapshots, assertions, onJumpToDiffs, onJumpToRefactors,
}: {
  run: SyncRun | null;
  snapshots: TrustSnapshot[];
  assertions: Map<AssertionId, Assertion>;
  onJumpToDiffs: () => void;
  onJumpToRefactors: () => void;
}) {
  const topDecay = useMemo(() => [...snapshots].sort((a, b) => a.trust - b.trust).slice(0, 3), [snapshots]);
  return (
    <div className="max-w-5xl mx-auto space-y-10">
      <RunCard run={run} />
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-x-10 gap-y-8">
        <div className="lg:col-span-7">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
            <Hourglass size={11} />
            Top decay · lowest trust
          </p>
          <div className="border border-border bg-surface divide-y divide-border">
            {topDecay.map((s) => {
              const a = assertions.get(s.assertionId);
              const pct = Math.round(s.trust * 100);
              const accent = s.trust < 0.4 ? "bg-rose" : s.trust < 0.7 ? "bg-warm" : "bg-green";
              return (
                <div key={s.assertionId} className="px-4 py-3.5">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <span className="text-[13px] font-medium text-foreground truncate">{a?.label ?? s.assertionId}</span>
                    <span className="text-[10px] uppercase tracking-[0.12em] text-muted tabular-nums font-medium shrink-0">{pct}%</span>
                  </div>
                  <div className="h-1 bg-border-light w-full overflow-hidden">
                    <div className={`h-full ${accent}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium mt-1.5 tabular-nums">
                    {Math.round(s.ageDays)}d old · half-life {s.halfLifeDays}d
                  </p>
                </div>
              );
            })}
          </div>
          <button onClick={onJumpToDiffs} className="mt-3 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] font-semibold text-violet hover:gap-2.5 transition-all">
            See all diffs
            <ArrowRight size={11} strokeWidth={2.25} />
          </button>
        </div>
        <div className="lg:col-span-5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3">Refactor queue</p>
          <RefactorSummary run={run} onJump={onJumpToRefactors} />
          <div className="mt-8">
            <PrincipleCard />
          </div>
        </div>
      </section>
    </div>
  );
}

function RefactorSummary({ run, onJump }: { run: SyncRun | null; onJump: () => void }) {
  const count = run?.refactorProposals.length ?? 0;
  if (count === 0) {
    return (
      <div className="border border-border bg-surface px-5 py-6 text-center">
        <p className="text-[13px] text-muted leading-relaxed">No refactors queued. Documents match the workspace truth.</p>
      </div>
    );
  }
  return (
    <button onClick={onJump} className="block w-full text-left border border-violet bg-foreground text-background p-5 relative overflow-hidden hover:bg-violet/95 transition-colors group">
      <span aria-hidden className="absolute left-0 top-0 w-[2px] h-full bg-violet" />
      <div className="flex items-center gap-2 mb-2">
        <FileText size={11} strokeWidth={2} className="text-violet" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-background/60 font-medium">Pending document rewrites</span>
      </div>
      <h3 className="font-display font-bold text-[22px] tracking-[-0.02em] leading-[1.15]">
        <span className="text-violet">{count}</span> block{count === 1 ? "" : "s"} need {count === 1 ? "a" : ""} refresh
      </h3>
      <p className="text-[12.5px] text-background/65 leading-relaxed mt-2">Lattice paragraphs that reference invalidated claims. Pulse pre-wrote the swap.</p>
      <span className="mt-3 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] font-semibold text-violet group-hover:gap-2.5 transition-all">
        Open refactors
        <ArrowRight size={11} strokeWidth={2.25} />
      </span>
    </button>
  );
}

/* ─────── Diffs panel ─────── */

function DiffsPanel({ run, assertions }: { run: SyncRun | null; assertions: Map<AssertionId, Assertion> }) {
  if (!run) {
    return <div className="border border-border bg-surface py-16 text-center text-muted text-[14px]">Running first sync…</div>;
  }
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium flex items-center gap-2">
        <Radio size={11} />
        Reality-diff · {run.diffs.length} claims checked
      </p>
      <ul className="divide-y divide-border border-y border-border">
        {run.diffs.map((d, i) => (
          <DiffRow key={d.assertionId} diff={d} index={i + 1} assertion={assertions.get(d.assertionId)} />
        ))}
      </ul>
    </div>
  );
}

function DiffRow({ diff, index, assertion }: { diff: RealityDiff; index: number; assertion?: Assertion }) {
  const tone = diff.status === "invalidated" ? "text-rose" : diff.status === "stale" ? "text-warm" : "text-green";
  const bg   = diff.status === "invalidated" ? "bg-rose"   : diff.status === "stale" ? "bg-warm"   : "bg-green";
  const trustPct = Math.round(diff.trustBefore * 100);
  return (
    <motion.li
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: Math.min(index, 12) * 0.015, ease }}
      className="py-4"
    >
      <div className="flex items-start gap-4">
        <span className="font-display font-bold text-muted text-[13px] tabular-nums tracking-tight pt-0.5 shrink-0 w-8">{String(index).padStart(2, "0")}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`flex items-center gap-1.5 text-[10px] uppercase tracking-[0.15em] font-semibold ${tone}`}>
              <span className={`w-1.5 h-1.5 ${bg}`} />
              {diff.status}
            </span>
            <span className="text-[10px] text-muted">·</span>
            <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">drift {(diff.driftRatio * 100).toFixed(1)}%</span>
            <span className="text-[10px] text-muted">·</span>
            <span className="text-[10px] uppercase tracking-[0.12em] font-medium tabular-nums flex items-center gap-1"><Hourglass size={9} /> trust {trustPct}%</span>
            {assertion?.locked && (
              <>
                <span className="text-[10px] text-muted">·</span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-violet font-medium flex items-center gap-1"><Lock size={9} /> locked</span>
              </>
            )}
          </div>
          <p className="text-[14px] text-foreground leading-relaxed">
            <span className="font-medium">{assertion?.label ?? diff.assertionId}</span>{" "}
            <span className="text-muted">— {diff.message}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-2 items-center text-[12px] tabular-nums">
            <span className="border border-border bg-surface px-2 py-1 text-muted text-[11px]">workspace · {describe(diff.workspaceValue)}</span>
            <TrendingDown size={11} className="text-muted" />
            <span className={`border border-border px-2 py-1 text-[11px] ${diff.status === "invalidated" ? "bg-foreground text-background" : "bg-background text-foreground"}`}>reality · {describe(diff.realityValue)}</span>
            {diff.realityAsOf && <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium">as of {diff.realityAsOf}</span>}
          </div>
          {diff.contributions && diff.contributions.length > 1 && (
            <ContributionBreakdown contributions={diff.contributions} />
          )}
        </div>
      </div>
    </motion.li>
  );
}

function ContributionBreakdown({ contributions }: { contributions: OracleContribution[] }) {
  const total = contributions.reduce((acc, c) => acc + Math.max(0, c.priority), 0);
  return (
    <div className="mt-2 border-l-2 border-cyan/40 pl-3 space-y-1">
      <p className="text-[10px] uppercase tracking-[0.15em] text-cyan font-semibold">
        {contributions.length} oracles · blended
      </p>
      {contributions.map((c) => {
        const share = total > 0 ? (c.priority / total) * 100 : 100 / contributions.length;
        return (
          <div key={c.oracleId} className="text-[11px] text-muted flex items-baseline gap-2 flex-wrap">
            <span className="font-semibold text-foreground">{c.oracleName}</span>
            <span className="text-cyan tabular-nums">×{c.priority}</span>
            <span className="tabular-nums">{share.toFixed(0)}% weight</span>
            <span className="text-muted">· {describe(c.reading.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

/* ─────── Refactors panel ─────── */

function RefactorsPanel({
  run,
  assertions,
  onAccept,
  onReject,
  onSkip,
}: {
  run: SyncRun | null;
  assertions: Map<AssertionId, Assertion>;
  onAccept: (p: RefactorProposal) => void | Promise<void>;
  onReject: (p: RefactorProposal) => void | Promise<void>;
  onSkip: (p: RefactorProposal) => void;
}) {
  if (!run) return null;
  if (run.refactorProposals.length === 0) {
    return (
      <div className="max-w-5xl mx-auto border border-border bg-surface py-16 text-center">
        <FileText size={20} className="mx-auto text-muted mb-2" strokeWidth={1.5} />
        <p className="text-[13px] text-muted">No refactors queued. Documents match the workspace truth.</p>
      </div>
    );
  }
  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium">
        Proposed document refactor · {run.refactorProposals.length} block{run.refactorProposals.length === 1 ? "" : "s"} pending review
      </p>
      <div className="space-y-6">
        <AnimatePresence initial={false}>
          {run.refactorProposals.map((p, i) => (
            <RefactorReview
              key={`${p.blockId}::${p.triggeredBy.join(",")}`}
              proposal={p}
              assertions={assertions}
              onAccept={onAccept}
              onReject={onReject}
              onSkip={onSkip}
              index={i}
            />
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ─────── shared ─────── */

function avgTrust(snaps: TrustSnapshot[]): number {
  if (snaps.length === 0) return 0;
  const sum = snaps.reduce((acc, s) => acc + s.trust, 0);
  return Math.round((sum / snaps.length) * 100);
}

function describe(v: Assertion["value"] | null | undefined): string {
  if (!v) return "—";
  switch (v.type) {
    case "number":  return `${v.value.toLocaleString()}${v.unit ? " " + v.unit : ""}`;
    case "string":  return `"${v.value}"`;
    case "date":    return v.value;
    case "boolean": return v.value ? "true" : "false";
  }
}

function Stat({ label, value, hint, tone, suffix }: { label: string; value: number; hint: string; tone: "rose" | "warm" | "green" | "cyan"; suffix?: string }) {
  const accent =
    tone === "rose"  ? "text-rose"  :
    tone === "warm"  ? "text-warm"  :
    tone === "cyan"  ? "text-cyan"  : "text-green";
  const card =
    tone === "rose"  ? "stat-card-rose"  :
    tone === "warm"  ? "stat-card-warm"  :
    tone === "cyan"  ? "stat-card-cyan"  : "stat-card-green";
  return (
    <div className={`${card} p-3.5`}>
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted font-medium">{label}</p>
      <p className={`font-display font-extrabold text-2xl tabular-nums tracking-[-0.02em] mt-1 ${accent}`}>{value}{suffix ?? ""}</p>
      <p className="text-[11px] text-muted mt-0.5">{hint}</p>
    </div>
  );
}

function CadenceSelect({ cadence, onChange }: { cadence: Cadence; onChange: (c: Cadence) => void }) {
  return (
    <div className="flex items-center border border-border">
      {CADENCES.map((c) => (
        <button
          key={c.key}
          onClick={() => onChange(c.key)}
          className={`text-[10px] uppercase tracking-[0.12em] font-semibold px-3 py-2.5 transition-colors duration-150 ${cadence === c.key ? "bg-foreground text-background" : "bg-background text-muted hover:text-foreground"}`}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function RunCard({ run }: { run: SyncRun | null }) {
  const cleanState = run && run.invalidatedCount === 0;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: 0.05, ease }}
      className={`border border-border ${cleanState ? "bg-foreground text-background" : "bg-surface"} p-6 relative overflow-hidden`}
    >
      <span aria-hidden className={`absolute top-0 left-0 w-[2px] h-full ${cleanState ? "bg-green" : "bg-violet"}`} />
      <div className="flex items-center gap-2 mb-3">
        <Radio size={12} strokeWidth={2.25} className={cleanState ? "text-green" : "text-violet"} />
        <span className={`text-[10px] uppercase tracking-[0.18em] font-medium ${cleanState ? "text-background/60" : "text-muted"}`}>Last sync</span>
      </div>
      <h3 className={`font-display font-bold text-[22px] tracking-[-0.02em] leading-[1.2] mb-2 ${cleanState ? "" : "text-foreground"}`}>
        {run ? (
          cleanState
            ? <>Aligned with <span className="text-green">today</span>.</>
            : <><span className="text-rose">{run.invalidatedCount}</span> {run.invalidatedCount === 1 ? "claim" : "claims"} to refactor.</>
        ) : "Waiting on first sync…"}
      </h3>
      {run && (
        <>
          <p className={`text-[13px] leading-relaxed ${cleanState ? "text-background/70" : "text-muted"}`}>
            Diff ran {new Date(run.ranAt).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}. {run.refactorProposals.length} document {run.refactorProposals.length === 1 ? "block" : "blocks"} flagged.
          </p>
          <p className={`text-[10px] uppercase tracking-[0.15em] mt-3 font-medium tabular-nums flex items-center gap-1.5 ${cleanState ? "text-background/45" : "text-muted"}`}>
            <Clock size={10} />
            {run.cadence} cadence
          </p>
        </>
      )}
    </motion.div>
  );
}

function PrincipleCard() {
  return (
    <div className="border border-border bg-surface p-5 relative overflow-hidden">
      <span aria-hidden className="absolute top-0 left-0 w-[2px] h-full bg-cyan" />
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={12} strokeWidth={2} className="text-cyan" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium">The principle</span>
      </div>
      <h3 className="font-display font-bold text-[17px] tracking-[-0.018em] leading-[1.25] mb-2 text-foreground">
        Facts decay. <span className="text-cyan">Docs shouldn&apos;t lie.</span>
      </h3>
      <p className="text-[12.5px] text-muted leading-relaxed">
        A salary you wrote down nine months ago isn&apos;t the salary today. Pulse re-checks every claim against current reality and rewrites the prose so your docs stay honest.
      </p>
    </div>
  );
}
