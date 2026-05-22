"use client";

/**
 * PulseProvider — shared state for the /pulse section.
 *
 * Hoisted into the section layout so /pulse, /pulse/diffs, and
 * /pulse/refactors all read the same run. Accepting a refactor on
 * /pulse/refactors immediately updates the overview's stats without a
 * re-sync; sub-nav navigation is just a route change, no data
 * thrash.
 *
 * Owns:
 *   • demo graph + blocks (mutable — accepted refactors swap block bodies)
 *   • cadence selection, run state, rejection map
 *   • derived: assertions, assertionMap, snapshots, diff buckets
 *   • actions: run, accept, reject, skip (each persists best-effort
 *     to the matching /api/pulse/* endpoint)
 *   • command-palette registration for refactor proposals
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DependencyGraph } from "@/lib/sync";
import type { Assertion, AssertionId } from "@/lib/sync";
import {
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
  type PulseConfig,
  type RefactorProposal,
  type SyncRun,
  type TrustSnapshot,
} from "@/lib/pulse";
import { useRegisterCommandSource, makeCommandId, type CommandItem } from "@/hooks/useCommandPalette";
import { recordActivity } from "@/lib/activity";
import { useAuth } from "@/context/AuthContext";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useSyncWorkspace } from "@/hooks/useSyncWorkspace";
import { usePulseWorkspace } from "@/hooks/usePulseWorkspace";
import { upsertBlock } from "@/lib/firestore/pulse";

export interface PulseCtx {
  /* derived data */
  assertions: Assertion[];
  assertionMap: Map<AssertionId, Assertion>;
  snapshots: TrustSnapshot[];
  run: SyncRun | null;
  /* counts (for sub-nav badges) */
  diffsCount: number;
  refactorsCount: number;
  invalidatedCount: number;
  staleCount: number;
  freshCount: number;
  /* controls */
  cadence: Cadence;
  setCadence: (c: Cadence) => void;
  running: boolean;
  runNow: () => Promise<void>;
  /* refactor actions */
  acceptRefactor: (p: RefactorProposal) => Promise<void>;
  rejectRefactor: (p: RefactorProposal) => Promise<void>;
  skipRefactor: (p: RefactorProposal) => void;
  /* project handle for child callbacks */
  projectId: string;
}

const PulseContext = createContext<PulseCtx | null>(null);

export function usePulse(): PulseCtx {
  const ctx = useContext(PulseContext);
  if (!ctx) throw new Error("usePulse() must be called inside <PulseProvider>");
  return ctx;
}

export function PulseProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { projectId } = useActiveProject();
  // Pulse needs the same assertion graph Sync owns — they share the
  // truth surface. Subscribe to the live Sync data instead of
  // re-reading it ourselves.
  const { graph: liveGraph } = useSyncWorkspace(projectId);
  const graph: DependencyGraph = liveGraph;

  // Pulse blocks come from their own collection.
  const { blocks: liveBlocks } = usePulseWorkspace(projectId);
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  useEffect(() => {
    setBlocks(liveBlocks);
  }, [liveBlocks]);

  const [cadence, setCadence] = useState<Cadence>("weekly");
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<SyncRun | null>(null);
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

  const runNow = useCallback(async () => {
    setRunning(true);
    const config: Partial<PulseConfig> = { ...defaultConfig(graph.projectId), cadence };
    const registry = defaultRegistry(2026);
    const next = await runSync({ assertions, blocks, oracle: registry, config });
    next.refactorProposals = filterRejected(next.refactorProposals, rejections);
    setRun(next);
    setRunning(false);
    recordActivity({
      source: "pulse",
      kind: "pulse.run",
      title: "Pulse · reality-sync",
      summary: `${next.invalidatedCount} invalidated · ${next.staleCount} stale · ${next.freshCount} fresh`,
      projectId: graph.projectId,
      uid: user?.uid,
      detail: { ...next, diffs: next.diffs.length, refactors: next.refactorProposals.length },
    });
  }, [graph.projectId, cadence, assertions, blocks, rejections, user?.uid]);

  // Initial sync on mount + whenever the source blocks change (e.g.
  // after a refactor is accepted and the block body gets replaced).
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

  const acceptRefactor = useCallback(async (proposal: RefactorProposal) => {
    // Optimistic local apply.
    let updated: ContentBlock | undefined;
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== proposal.blockId) return b;
        updated = { ...b, body: proposal.after };
        return updated;
      }),
    );
    setRun((prev) => (prev ? {
      ...prev,
      refactorProposals: prev.refactorProposals.filter((p) => p.blockId !== proposal.blockId || rejectionKeyOf(p) !== rejectionKeyOf(proposal)),
    } : prev));
    // Persist the new block body so the next subscription emit doesn't
    // overwrite the local optimistic state.
    if (updated && user?.uid && projectId) {
      void upsertBlock({ uid: user.uid, projectId }, updated).catch((err) => {
        console.warn("[pulse] block persist failed:", err);
      });
    }
    recordActivity({
      source: "pulse",
      kind: "pulse.refactor.accept",
      title: "Pulse · refactor accepted",
      summary: `${proposal.kind === "value-swap" ? "Safe swap" : "Text rewrite"} on ${proposal.blockId}`,
      projectId: graph.projectId,
      uid: user?.uid,
      detail: { blockId: proposal.blockId, triggers: proposal.triggeredBy },
    });
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
  }, [graph.projectId, user?.uid, projectId]);

  const rejectRefactor = useCallback(async (proposal: RefactorProposal) => {
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
    recordActivity({
      source: "pulse",
      kind: "pulse.refactor.reject",
      title: "Pulse · refactor rejected",
      summary: `${proposal.kind === "value-swap" ? "Safe swap" : "Text rewrite"} on ${proposal.blockId} declined (7-day cooldown)`,
      projectId: graph.projectId,
      uid: user?.uid,
      detail: { blockId: proposal.blockId, triggers: proposal.triggeredBy, expiresAt },
    });
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
  }, [graph.projectId, user?.uid]);

  const skipRefactor = useCallback((proposal: RefactorProposal) => {
    setRun((prev) => (prev ? {
      ...prev,
      refactorProposals: prev.refactorProposals.filter((p) => p !== proposal),
    } : prev));
  }, []);

  /* command palette — surface refactor proposals as actions */
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
        href: "/pulse/refactors",
        anchor: `refactor-${p.blockId}`,
      };
    });
  }, [run, assertionMap]);
  useRegisterCommandSource("pulse.refactors", refactorCommands);

  const invalidatedCount = run ? run.diffs.filter((d) => d.status === "invalidated").length : 0;
  const staleCount       = run ? run.diffs.filter((d) => d.status === "stale").length       : 0;
  const freshCount       = run ? run.diffs.filter((d) => d.status === "fresh").length       : 0;

  const value: PulseCtx = {
    assertions,
    assertionMap,
    snapshots,
    run,
    diffsCount: run?.diffs.length ?? 0,
    refactorsCount: run?.refactorProposals.length ?? 0,
    invalidatedCount,
    staleCount,
    freshCount,
    cadence,
    setCadence,
    running,
    runNow,
    acceptRefactor,
    rejectRefactor,
    skipRefactor,
    projectId: graph.projectId,
  };

  return <PulseContext.Provider value={value}>{children}</PulseContext.Provider>;
}
