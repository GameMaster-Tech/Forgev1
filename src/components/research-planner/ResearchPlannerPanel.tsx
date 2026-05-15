"use client";

/**
 * ResearchPlannerPanel — the main planner surface.
 *
 * Two-column layout:
 *   Left  — Suggestions feed (pending; sorted by weightedScore)
 *   Right — Active plan + manual-add + learning footer
 *
 * Behaviour:
 *   • Loads suggestions + plan items + weights on mount.
 *   • "Refresh" button runs `scanProject` and merges new suggestions.
 *   • Accept / Dismiss are optimistic and atomic.
 *   • Learning is reflected in the "Forge has learned…" footer.
 *
 * Hard rule (per the spec): Forge NEVER creates plan items on its own.
 * The only path from Suggestion → PlanItem is the user clicking
 * "Add to plan".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  RefreshCw,
  Loader2,
  Plus,
  Sparkles,
  CheckCircle2,
  FileQuestion,
  Library,
  AlertTriangle,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/AuthContext";
import {
  acceptSuggestion as fbAcceptSuggestion,
  createPlanItem,
  deletePlanItem,
  dismissSuggestion as fbDismissSuggestion,
  listPlanItems,
  listSuggestions,
  loadWeights,
  recordDecision,
  scanProject,
  updatePlanItem,
  type PlanItem,
  type PlannerWeights,
  type Suggestion,
  type SuggestionKind,
  type PlanItemStatus,
  ALL_KINDS,
} from "@/lib/research-planner";
import SuggestionCard from "./SuggestionCard";
import PlanItemRow from "./PlanItemRow";

const KIND_DISPLAY: Record<
  SuggestionKind,
  { label: string; icon: typeof Sparkles; accent: string }
> = {
  "undersupported-claim": { label: "Undersupported claims", icon: FileQuestion, accent: "text-warm" },
  "underread-topic": { label: "Thin coverage", icon: Library, accent: "text-cyan" },
  contradiction: { label: "Contradictions", icon: AlertTriangle, accent: "text-rose" },
};

interface Props {
  projectId: string;
}

export default function ResearchPlannerPanel({ projectId }: Props) {
  const { user } = useAuth();
  const ownerId = user?.uid;

  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [planItems, setPlanItems] = useState<PlanItem[]>([]);
  const [weights, setWeights] = useState<PlannerWeights | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [manualTitle, setManualTitle] = useState("");

  /* ── Initial load ────────────────────────────────────────── */

  const refresh = useCallback(async () => {
    if (!ownerId) return;
    const [sugs, items, w] = await Promise.all([
      listSuggestions(projectId, ownerId, "pending"),
      listPlanItems(projectId, ownerId),
      loadWeights(projectId, ownerId),
    ]);
    setSuggestions(sugs);
    setPlanItems(items);
    setWeights(w);
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

  /* ── Scan ────────────────────────────────────────────────── */

  const runScan = useCallback(async () => {
    if (!ownerId || scanning) return;
    setScanning(true);
    try {
      const result = await scanProject(projectId, ownerId);
      await refresh();
      const news = result.newlyPersisted;
      const total = result.totalDetected;
      if (news === 0 && total === 0) {
        toast("No gaps found.", { description: "Your project looks well-covered right now." });
      } else if (news === 0) {
        toast("Up to date.", { description: `${total} potential gap${total === 1 ? "" : "s"} reviewed — none new.` });
      } else {
        toast(`${news} new suggestion${news === 1 ? "" : "s"}.`, {
          description: "Review them on the left.",
        });
      }
    } catch (err) {
      console.error(err);
      toast.error("Scan failed.", { description: "Please retry in a moment." });
    } finally {
      setScanning(false);
    }
  }, [projectId, ownerId, refresh, scanning]);

  /* ── Accept / Dismiss (optimistic) ───────────────────────── */

  const accept = useCallback(
    async (s: Suggestion) => {
      if (!ownerId) return;
      setPendingIds((p) => new Set(p).add(s.id));
      setSuggestions((cur) => cur.filter((x) => x.id !== s.id));
      try {
        await fbAcceptSuggestion(s);
        // Optimistic plan-item insert so the right rail updates instantly.
        const optimistic: PlanItem = {
          id: `optimistic-${s.id}`,
          projectId: s.projectId,
          ownerId: s.ownerId,
          title: s.proposedAction,
          notes: s.rationale,
          status: "open",
          origin: "suggestion",
          sourceSuggestionId: s.id,
          kind: s.kind,
          refs: s.refs,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        setPlanItems((cur) => [optimistic, ...cur]);
        // Learning bump.
        const next = await recordDecision(projectId, ownerId, s.kind, "accept");
        setWeights(next);
        // Refresh real plan items so the optimistic row gets replaced
        // with the real one (Firestore ids match).
        const real = await listPlanItems(projectId, ownerId);
        setPlanItems(real);
        toast("Added to plan.", { description: s.proposedAction });
      } catch (err) {
        console.error(err);
        toast.error("Couldn't add to plan.");
        // Roll back: re-fetch suggestions.
        await refresh();
      } finally {
        setPendingIds((p) => {
          const next = new Set(p);
          next.delete(s.id);
          return next;
        });
      }
    },
    [projectId, ownerId, refresh],
  );

  const dismiss = useCallback(
    async (s: Suggestion) => {
      if (!ownerId) return;
      setPendingIds((p) => new Set(p).add(s.id));
      setSuggestions((cur) => cur.filter((x) => x.id !== s.id));
      try {
        await fbDismissSuggestion(s);
        const next = await recordDecision(projectId, ownerId, s.kind, "dismiss");
        setWeights(next);
      } catch (err) {
        console.error(err);
        toast.error("Couldn't dismiss.");
        await refresh();
      } finally {
        setPendingIds((p) => {
          const next = new Set(p);
          next.delete(s.id);
          return next;
        });
      }
    },
    [projectId, ownerId, refresh],
  );

  /* ── Plan-item operations ────────────────────────────────── */

  const STATUS_CYCLE: PlanItemStatus[] = ["open", "in-progress", "done"];

  const cycleStatus = useCallback(
    async (item: PlanItem) => {
      const idx = STATUS_CYCLE.indexOf(item.status as PlanItemStatus);
      const next = STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
      setPlanItems((cur) =>
        cur.map((p) => (p.id === item.id ? { ...p, status: next } : p)),
      );
      try {
        await updatePlanItem(item.id, { status: next });
      } catch {
        toast.error("Couldn't update status.");
        await refresh();
      }
    },
    [refresh],
  );

  const archive = useCallback(
    async (item: PlanItem) => {
      setPlanItems((cur) =>
        cur.map((p) => (p.id === item.id ? { ...p, status: "archived" } : p)),
      );
      try {
        await updatePlanItem(item.id, { status: "archived" });
      } catch {
        toast.error("Couldn't archive.");
        await refresh();
      }
    },
    [refresh],
  );

  const remove = useCallback(
    async (item: PlanItem) => {
      setPlanItems((cur) => cur.filter((p) => p.id !== item.id));
      try {
        await deletePlanItem(item.id);
      } catch {
        toast.error("Couldn't delete.");
        await refresh();
      }
    },
    [refresh],
  );

  const addManual = useCallback(async () => {
    if (!ownerId) return;
    const title = manualTitle.trim();
    if (!title) return;
    setManualTitle("");
    const optimistic: PlanItem = {
      id: `optimistic-manual-${Date.now()}`,
      projectId,
      ownerId,
      title,
      status: "open",
      origin: "manual",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setPlanItems((cur) => [optimistic, ...cur]);
    try {
      await createPlanItem({
        projectId,
        ownerId,
        title,
        origin: "manual",
      });
      const real = await listPlanItems(projectId, ownerId);
      setPlanItems(real);
    } catch {
      toast.error("Couldn't add item.");
      await refresh();
    }
  }, [projectId, ownerId, manualTitle, refresh]);

  /* ── Derived UI state ────────────────────────────────────── */

  const activePlan = useMemo(
    () => planItems.filter((p) => p.status !== "archived"),
    [planItems],
  );
  const archivedCount = planItems.length - activePlan.length;

  const learningSummary = useMemo(() => {
    if (!weights) return null;
    const lines: Array<{ kind: SuggestionKind; rate: number; bias: "boosted" | "suppressed" | "neutral" }> = [];
    for (const k of ALL_KINDS) {
      const accepts = weights.acceptCounts[k] ?? 0;
      const dismisses = weights.dismissCounts[k] ?? 0;
      const total = accepts + dismisses;
      const rate = total === 0 ? 0.5 : accepts / total;
      const w = weights.weights[k] ?? 1;
      const bias = w > 1.05 ? "boosted" : w < 0.95 ? "suppressed" : "neutral";
      lines.push({ kind: k, rate, bias });
    }
    return lines;
  }, [weights]);

  /* ── Render ──────────────────────────────────────────────── */

  if (!ownerId) {
    return (
      <div className="rounded-xl border border-foreground/10 bg-background p-6 text-sm text-foreground/60">
        Sign in to use the research planner.
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-foreground/55">
            <Sparkles size={12} strokeWidth={1.75} className="text-violet" />
            Research planner
          </div>
          <h1 className="mt-1 font-display text-2xl text-foreground">
            What Forge thinks you should read next.
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-foreground/60">
            Suggestions are surfaced from your claim graph, documents, and contradictions. Forge never adds anything to your plan without your tap.
          </p>
        </div>
        <button
          type="button"
          onClick={runScan}
          disabled={scanning}
          className="inline-flex items-center gap-2 rounded-lg border border-foreground/15 px-3.5 py-2 text-xs font-medium text-foreground/80 transition-colors hover:border-violet/40 hover:bg-violet/[0.04] hover:text-foreground disabled:opacity-60"
        >
          {scanning ? (
            <Loader2 size={14} strokeWidth={1.75} className="animate-spin" />
          ) : (
            <RefreshCw size={14} strokeWidth={1.75} />
          )}
          {scanning ? "Scanning…" : "Scan for gaps"}
        </button>
      </div>

      {/* Two-column body */}
      <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        {/* ── Suggestions ──────────────────────────────── */}
        <section>
          <div className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-foreground/55">
            <ListChecks size={12} strokeWidth={1.75} />
            Suggestions
            <span className="rounded-full bg-foreground/[0.05] px-1.5 py-0.5 text-[9px] tabular-nums text-foreground/55">
              {suggestions.length}
            </span>
          </div>

          {loading ? (
            <div className="flex items-center gap-2 rounded-xl border border-foreground/10 bg-background p-6 text-sm text-foreground/55">
              <Loader2 size={14} className="animate-spin" />
              Loading suggestions…
            </div>
          ) : suggestions.length === 0 ? (
            <EmptyState onScan={runScan} scanning={scanning} />
          ) : (
            <div className="flex flex-col gap-3">
              <AnimatePresence initial={false}>
                {suggestions.map((s) => (
                  <SuggestionCard
                    key={s.id}
                    suggestion={s}
                    onAccept={accept}
                    onDismiss={dismiss}
                    pending={pendingIds.has(s.id)}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </section>

        {/* ── Plan + manual add + learning ─────────────── */}
        <aside className="space-y-6">
          {/* Plan list */}
          <section className="rounded-xl border border-foreground/10 bg-background">
            <div className="flex items-center justify-between border-b border-foreground/[0.06] px-4 py-3">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-foreground/55">
                <CheckCircle2 size={12} strokeWidth={1.75} className="text-violet" />
                Your plan
                <span className="rounded-full bg-foreground/[0.05] px-1.5 py-0.5 text-[9px] tabular-nums text-foreground/55">
                  {activePlan.length}
                </span>
              </div>
              {archivedCount > 0 && (
                <span className="text-[10px] text-foreground/40">
                  +{archivedCount} archived
                </span>
              )}
            </div>

            {/* Manual add */}
            <div className="border-b border-foreground/[0.06] px-4 py-3">
              <div className="flex items-center gap-2">
                <Plus size={14} strokeWidth={1.5} className="text-foreground/40" />
                <input
                  type="text"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addManual();
                  }}
                  placeholder="Add your own item…"
                  className="flex-1 border-none bg-transparent text-sm text-foreground placeholder:text-foreground/35 focus:outline-none"
                />
                {manualTitle.trim() && (
                  <button
                    type="button"
                    onClick={addManual}
                    className="rounded-md bg-foreground px-2.5 py-1 text-[11px] font-medium text-background hover:opacity-90"
                  >
                    Add
                  </button>
                )}
              </div>
            </div>

            {/* Plan rows */}
            <div className="px-2 py-2">
              {activePlan.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-foreground/45">
                  Nothing on your plan yet.
                  <br />
                  Accept a suggestion or add your own.
                </div>
              ) : (
                <div className="flex flex-col">
                  <AnimatePresence initial={false}>
                    {activePlan.map((item) => (
                      <PlanItemRow
                        key={item.id}
                        item={item}
                        onCycleStatus={cycleStatus}
                        onArchive={archive}
                        onDelete={remove}
                      />
                    ))}
                  </AnimatePresence>
                </div>
              )}
            </div>
          </section>

          {/* Learning footer */}
          {learningSummary && (
            <section className="rounded-xl border border-foreground/10 bg-background p-4">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-foreground/55">
                <Sparkles size={12} strokeWidth={1.75} className="text-violet" />
                Forge has learned
              </div>
              <ul className="mt-3 space-y-2">
                {learningSummary.map(({ kind, rate, bias }) => {
                  const meta = KIND_DISPLAY[kind];
                  const KIcon = meta.icon;
                  const ratePct = Math.round(rate * 100);
                  return (
                    <li key={kind} className="flex items-center gap-2 text-[12px] text-foreground/70">
                      <KIcon size={12} strokeWidth={1.75} className={meta.accent} />
                      <span className="flex-1">{meta.label}</span>
                      <span className="tabular-nums text-foreground/45">{ratePct}% accept</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] ${
                          bias === "boosted"
                            ? "bg-violet/[0.08] text-violet"
                            : bias === "suppressed"
                              ? "bg-foreground/[0.05] text-foreground/40"
                              : "bg-foreground/[0.04] text-foreground/55"
                        }`}
                      >
                        {bias}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-[11px] leading-relaxed text-foreground/45">
                Suggestions you accept get surfaced more. Ones you dismiss get quieter. Forge never adds items on your behalf.
              </p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

/* ── Empty state ─────────────────────────────────────────────── */

function EmptyState({
  onScan,
  scanning,
}: {
  onScan: () => void;
  scanning: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="rounded-xl border border-dashed border-foreground/15 bg-foreground/[0.015] p-8 text-center"
    >
      <Sparkles size={20} strokeWidth={1.5} className="mx-auto text-violet/60" />
      <h3 className="mt-3 font-display text-base text-foreground">
        No suggestions right now.
      </h3>
      <p className="mx-auto mt-1.5 max-w-sm text-[13px] leading-relaxed text-foreground/55">
        Either the project is well-covered, or no scan has run yet. Tap below to look for gaps.
      </p>
      <button
        type="button"
        onClick={onScan}
        disabled={scanning}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-violet px-3.5 py-2 text-xs font-medium text-background hover:opacity-90 disabled:opacity-60"
      >
        {scanning ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <RefreshCw size={13} strokeWidth={2} />
        )}
        Scan for gaps
      </button>
    </motion.div>
  );
}
