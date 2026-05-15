"use client";

/**
 * CounterforgePanel — the adversarial-review surface.
 *
 * Hero
 *   ┌────────────────────────────────────────────────────────┐
 *   │ Readiness {pct}%                  [Run scan]           │
 *   │ refuted · conceded · open · deferred · stale           │
 *   └────────────────────────────────────────────────────────┘
 *
 * Body
 *   filter tabs: All / Open / Closed / Stale
 *   feed of CounterCaseCard, one per claim ↔ counter pair
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Loader2,
  RefreshCw,
  Swords,
  ShieldCheck,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import {
  computeReadiness,
  deleteCounterCase as fbDelete,
  listCounterCases,
  scanProject,
  updateCounterCase,
  type CounterCase,
  type CounterCaseStatus,
  type ReadinessScore,
} from "@/lib/counterforge";
import CounterCaseCard from "./CounterCaseCard";

type Filter = "all" | "open" | "closed" | "stale";

interface Props {
  projectId: string;
}

export default function CounterforgePanel({ projectId }: Props) {
  const { user } = useAuth();
  const ownerId = user?.uid;

  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [cases, setCases] = useState<CounterCase[]>([]);
  const [filter, setFilter] = useState<Filter>("open");
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  /* ── load ──────────────────────────────────────────────── */
  const refresh = useCallback(async () => {
    if (!ownerId) return;
    const all = await listCounterCases(projectId, ownerId);
    setCases(all);
  }, [projectId, ownerId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!ownerId) return;
      setLoading(true);
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, ownerId]);

  /* ── scan ──────────────────────────────────────────────── */
  const runScan = useCallback(async () => {
    if (!ownerId || scanning) return;
    setScanning(true);
    try {
      const result = await scanProject(projectId, ownerId);
      await refresh();
      const msg =
        result.newCases === 0 && result.rescoredStale === 0
          ? "No new counter-cases. Your claims look solid for now."
          : `${result.newCases} new · ${result.rescoredStale} marked stale`;
      toast(`Scan complete (${result.durationMs}ms)`, { description: msg });
    } catch (err) {
      console.error(err);
      toast.error("Scan failed.", { description: "Retry in a moment." });
    } finally {
      setScanning(false);
    }
  }, [projectId, ownerId, refresh, scanning]);

  /* ── actions ───────────────────────────────────────────── */
  const setPending = (id: string, on: boolean) => {
    setPendingIds((cur) => {
      const next = new Set(cur);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const refute = useCallback(
    async (id: string, source: string) => {
      setPending(id, true);
      setCases((cur) =>
        cur.map((c) =>
          c.id === id
            ? { ...c, status: "refuted", refutationSource: source }
            : c,
        ),
      );
      try {
        await updateCounterCase(id, { status: "refuted", refutationSource: source });
        toast("Refuted.");
      } catch {
        toast.error("Couldn't mark refuted.");
        await refresh();
      } finally {
        setPending(id, false);
      }
    },
    [refresh],
  );

  const concede = useCallback(
    async (id: string, caveat: string) => {
      setPending(id, true);
      setCases((cur) =>
        cur.map((c) =>
          c.id === id
            ? { ...c, status: "conceded", concededCaveat: caveat }
            : c,
        ),
      );
      try {
        await updateCounterCase(id, { status: "conceded", concededCaveat: caveat });
        toast("Caveat recorded.", {
          description: "Add it to your draft when you next edit.",
        });
      } catch {
        toast.error("Couldn't mark conceded.");
        await refresh();
      } finally {
        setPending(id, false);
      }
    },
    [refresh],
  );

  const defer = useCallback(
    async (id: string) => {
      setPending(id, true);
      setCases((cur) =>
        cur.map((c) => (c.id === id ? { ...c, status: "deferred" } : c)),
      );
      try {
        await updateCounterCase(id, { status: "deferred" });
      } catch {
        toast.error("Couldn't defer.");
        await refresh();
      } finally {
        setPending(id, false);
      }
    },
    [refresh],
  );

  const reopen = useCallback(
    async (id: string) => {
      setPending(id, true);
      setCases((cur) =>
        cur.map((c) => (c.id === id ? { ...c, status: "open" } : c)),
      );
      try {
        await updateCounterCase(id, { status: "open" });
      } catch {
        toast.error("Couldn't reopen.");
        await refresh();
      } finally {
        setPending(id, false);
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      setPending(id, true);
      setCases((cur) => cur.filter((c) => c.id !== id));
      try {
        await fbDelete(id);
      } catch {
        toast.error("Couldn't delete.");
        await refresh();
      } finally {
        setPending(id, false);
      }
    },
    [refresh],
  );

  /* ── derived ───────────────────────────────────────────── */
  const readiness = useMemo<ReadinessScore>(() => computeReadiness(cases), [cases]);

  const filtered = useMemo(() => {
    switch (filter) {
      case "open":
        return cases.filter(
          (c) => c.status === "open" || c.status === "deferred",
        );
      case "closed":
        return cases.filter(
          (c) => c.status === "refuted" || c.status === "conceded",
        );
      case "stale":
        return cases.filter((c) => c.status === "stale");
      default:
        return cases;
    }
  }, [cases, filter]);

  /* ── render ────────────────────────────────────────────── */
  if (!ownerId) {
    return (
      <div className="rounded-xl border border-foreground/10 bg-background p-6 text-sm text-foreground/60">
        Sign in to use Counterforge.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-foreground/55">
            <Swords size={12} strokeWidth={1.75} className="text-rose" />
            Counterforge
          </div>
          <h1 className="mt-1 font-display text-2xl text-foreground">
            The skeptic that lives inside your project.
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-foreground/60">
            Counterforge constructs the strongest counter-case it can for every load-bearing claim in your draft, using sources from your own corpus. Address them before peer review does.
          </p>
        </div>
        <button
          type="button"
          onClick={runScan}
          disabled={scanning}
          className="inline-flex items-center gap-2 rounded-lg border border-foreground/15 px-3.5 py-2 text-xs font-medium text-foreground/80 transition-colors hover:border-rose/40 hover:bg-rose/[0.04] hover:text-foreground disabled:opacity-60"
        >
          {scanning ? (
            <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />
          ) : (
            <RefreshCw size={14} strokeWidth={1.75} />
          )}
          {scanning ? "Building counters…" : "Run scan"}
        </button>
      </div>

      {/* Readiness strip */}
      <ReadinessStrip readiness={readiness} />

      {/* Filter tabs */}
      <div className="flex flex-wrap items-center gap-1 border-b border-foreground/[0.06]">
        {(
          [
            ["open", "Open", readiness.open + readiness.deferred],
            ["closed", "Closed", readiness.refuted + readiness.conceded],
            ["stale", "Stale", readiness.stale],
            ["all", "All", cases.length],
          ] as Array<[Filter, string, number]>
        ).map(([key, label, count]) => {
          const active = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`relative -mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[11px] uppercase tracking-[0.14em] transition-colors ${
                active
                  ? "border-rose text-foreground"
                  : "border-transparent text-foreground/55 hover:text-foreground/80"
              }`}
            >
              {label}
              <span className="rounded-full bg-foreground/[0.05] px-1.5 py-0.5 text-[9px] tabular-nums text-foreground/55">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Feed */}
      {loading ? (
        <div className="flex items-center gap-2 rounded-xl border border-foreground/10 bg-background p-6 text-sm text-foreground/55">
          <Loader2 size={14} className="animate-spin" />
          Loading counter-cases…
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState filter={filter} onScan={runScan} scanning={scanning} totalCases={cases.length} />
      ) : (
        <div className="flex flex-col gap-4">
          <AnimatePresence initial={false}>
            {filtered.map((c) => (
              <CounterCaseCard
                key={c.id}
                case={c}
                pending={pendingIds.has(c.id)}
                onRefute={refute}
                onConcede={concede}
                onDefer={defer}
                onReopen={reopen}
                onDelete={remove}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

/* ── Readiness strip ─────────────────────────────────────────── */

function ReadinessStrip({ readiness }: { readiness: ReadinessScore }) {
  const pct = Math.round(readiness.pct * 100);
  const denom = readiness.refuted + readiness.conceded + readiness.open + readiness.deferred;
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border border-foreground/10 bg-background p-5"
    >
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-foreground/55">
            Readiness
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-display text-4xl tabular-nums text-foreground">
              {pct}%
            </span>
            <span className="text-[11px] text-foreground/50">
              of {denom} resolvable case{denom === 1 ? "" : "s"} addressed
            </span>
          </div>
        </div>
        <Legend readiness={readiness} />
      </div>
      {/* Progress bar */}
      <div className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-foreground/[0.06]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-violet via-cyan to-violet transition-[width] duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </motion.div>
  );
}

function Legend({ readiness }: { readiness: ReadinessScore }) {
  const rows: Array<[string, number, string, typeof ShieldCheck]> = [
    ["Refuted", readiness.refuted, "text-violet", ShieldCheck],
    ["Conceded", readiness.conceded, "text-cyan", ShieldCheck],
    ["Open", readiness.open, "text-foreground/70", Swords],
    ["Deferred", readiness.deferred, "text-foreground/50", Clock],
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
      {rows.map(([label, count, color, Icon]) => (
        <div key={label} className="flex items-center gap-1.5 text-[11px]">
          <Icon size={11} strokeWidth={1.75} className={color} />
          <span className="text-foreground/55">{label}</span>
          <span className={`tabular-nums ${color}`}>{count}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Empty state ─────────────────────────────────────────────── */

function EmptyState({
  filter,
  onScan,
  scanning,
  totalCases,
}: {
  filter: Filter;
  onScan: () => void;
  scanning: boolean;
  totalCases: number;
}) {
  if (totalCases === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="rounded-xl border border-dashed border-foreground/15 bg-foreground/[0.015] p-8 text-center"
      >
        <Swords size={20} strokeWidth={1.5} className="mx-auto text-rose/60" />
        <h3 className="mt-3 font-display text-base text-foreground">
          No counter-cases yet.
        </h3>
        <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-foreground/55">
          Run a scan and Counterforge will read your draft, identify load-bearing claims, and build the strongest counter-case it can from your own sources.
        </p>
        <button
          type="button"
          onClick={onScan}
          disabled={scanning}
          className="mt-4 inline-flex items-center gap-2 rounded-lg bg-rose px-3.5 py-2 text-xs font-medium text-background hover:opacity-90 disabled:opacity-60"
        >
          {scanning ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RefreshCw size={13} strokeWidth={2} />
          )}
          Run scan
        </button>
      </motion.div>
    );
  }
  const phrase = {
    open: "Nothing open right now.",
    closed: "No closed cases yet.",
    stale: "No stale cases.",
    all: "No cases.",
  }[filter];
  return (
    <div className="rounded-xl border border-dashed border-foreground/10 bg-background p-6 text-center text-sm text-foreground/55">
      {phrase}
    </div>
  );
}
