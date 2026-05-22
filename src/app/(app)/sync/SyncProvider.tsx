"use client";

/**
 * SyncProvider — section-shared state for /sync.
 *
 * Mirrors PulseProvider: the layout mounts this once and every
 * sub-route reads from useSync(). State + actions live here so a
 * compile on /sync immediately surfaces on /sync/conflicts and an
 * apply on /sync/patch updates the verdict for everyone — no
 * cross-route thrash, no re-derivation.
 *
 * Owns:
 *   • DependencyGraph (mutable — apply replaces the whole graph)
 *   • computed report, violations, document index, assertion index
 *   • patch + computing flag
 *   • undo buffer
 *   • command-palette registration for assertions + documents
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
import {
  applyPatch,
  captureUndo,
  checkStability,
  DependencyGraph,
  detectViolations,
  proposePatch,
  pushUndo,
  revertLast,
  type Assertion,
  type AssertionId,
  type DocumentNode,
  type LogicalPatch,
  type StabilityReport,
  type UndoEntry,
  type Violation,
} from "@/lib/sync";
import { useRegisterCommandSource, makeCommandId, type CommandItem } from "@/hooks/useCommandPalette";
import { recordActivity } from "@/lib/activity";
import { useAuth } from "@/context/AuthContext";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useSyncWorkspace } from "@/hooks/useSyncWorkspace";
import { applyGraphToFirestore } from "@/lib/firestore/sync";

export interface SyncCtx {
  /* derived */
  graph: DependencyGraph;
  report: StabilityReport;
  violations: Violation[];
  documents: DocumentNode[];
  assertionsById: Map<AssertionId, Assertion>;
  /* state */
  patch: LogicalPatch | null;
  computing: boolean;
  undoLog: UndoEntry[];
  /* counts (for sub-nav badges + overview tiles) */
  conflictsCount: number;
  hardConflicts: number;
  softConflicts: number;
  hasPatch: boolean;
  patchChanges: number;
  documentsCount: number;
  historyCount: number;
  /* actions */
  compile: () => void;
  applyCurrentPatch: () => void;
  discardPatch: () => void;
  undoLast: () => void;
  resetDemo: () => void;
  /* meta */
  projectId: string;
}

const SyncContext = createContext<SyncCtx | null>(null);

export function useSync(): SyncCtx {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error("useSync() must be called inside <SyncProvider>");
  return ctx;
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { projectId } = useActiveProject();
  // Live Firestore-backed graph for the active project. Empty graph
  // when no user / no project — UI renders its own empty state.
  const { graph: liveGraph, hydrated } = useSyncWorkspace(projectId);

  // Local working copy of the graph. Mirrors Firestore on every emit
  // unless the user has an unresolved local-only modification (an
  // undo-able patch waiting for commit). When the patch is applied or
  // discarded we re-sync from Firestore again.
  const [graph, setGraph] = useState<DependencyGraph>(liveGraph);
  useEffect(() => {
    setGraph(liveGraph);
  }, [liveGraph]);

  const [patch, setPatch] = useState<LogicalPatch | null>(null);
  const [computing, setComputing] = useState(false);
  const [undoLog, setUndoLog] = useState<UndoEntry[]>([]);

  const report = useMemo<StabilityReport>(() => checkStability(graph), [graph]);
  const violations = useMemo<Violation[]>(() => detectViolations(graph), [graph]);
  const documents = useMemo<DocumentNode[]>(() => graph.listDocuments(), [graph]);
  const assertionsById = useMemo<Map<AssertionId, Assertion>>(
    () => new Map(graph.listAssertions().map((a) => [a.id, a] as const)),
    [graph],
  );

  const compile = useCallback(() => {
    setComputing(true);
    setTimeout(() => {
      const next = proposePatch(graph, { now: Date.now() });
      setPatch(next);
      setComputing(false);
      recordActivity({
        source: "sync",
        kind: "sync.compile",
        title: "Sync · compiled",
        summary: `${next.changes.length} proposed change${next.changes.length === 1 ? "" : "s"} · ${next.iterations} iter`,
        projectId: graph.projectId,
        uid: user?.uid,
        detail: { reachesStable: next.reachesStableState, iterations: next.iterations },
      });
    }, 350);
  }, [graph, user?.uid]);

  const applyCurrentPatch = useCallback(() => {
    if (!patch) return;
    const clone = cloneGraph(graph);
    const entry = captureUndo(clone, patch);
    applyPatch(clone, patch);
    setGraph(clone);
    setUndoLog((prev) => pushUndo(prev, entry));
    setPatch(null);
    // Persist the post-patch graph back to Firestore so other tabs /
    // members see the change. Fire-and-forget — the local state is
    // already updated; if the write fails the next subscription emit
    // will rehydrate the canonical truth.
    if (user?.uid && projectId) {
      void applyGraphToFirestore({ uid: user.uid, projectId }, clone).catch((err) => {
        console.warn("[sync] applyGraphToFirestore failed:", err);
      });
    }
    recordActivity({
      source: "sync",
      kind: "sync.patch.apply",
      title: "Sync · patch applied",
      summary: patch.summary,
      projectId: graph.projectId,
      uid: user?.uid,
      detail: { changeCount: patch.changes.length, patchId: patch.id },
    });
  }, [graph, patch, user?.uid, projectId]);

  const discardPatch = useCallback(() => {
    setPatch(null);
  }, []);

  const undoLast = useCallback(() => {
    if (undoLog.length === 0) return;
    const clone = cloneGraph(graph);
    const last = undoLog[undoLog.length - 1];
    const { buffer } = revertLast(clone, undoLog);
    setGraph(clone);
    setUndoLog(buffer);
    setPatch(null);
    recordActivity({
      source: "sync",
      kind: "sync.patch.undo",
      title: "Sync · patch undone",
      summary: last.summary,
      projectId: graph.projectId,
      uid: user?.uid,
      detail: { patchId: last.id },
    });
  }, [graph, undoLog, user?.uid]);

  const resetDemo = useCallback(() => {
    // Reset = bounce back to the canonical Firestore graph and clear
    // local-only state. With per-project persistence in place, this
    // is effectively "discard local edits and re-pull."
    setGraph(liveGraph);
    setPatch(null);
    setUndoLog([]);
  }, [liveGraph]);

  // hydrated is part of the API surface — once the spec page builds
  // a loading state it'll consume this. For now it stays internal.
  void hydrated;

  /* command palette — surface assertions + documents */
  const assertionItems = useMemo<CommandItem[]>(() => {
    return graph.listAssertions().map((a) => ({
      id: makeCommandId("sync.assertion", a.id),
      kind: "assertion" as const,
      label: a.label,
      subtitle: `${a.key} · ${a.kind}`,
      keywords: [a.key, a.kind, a.documentId, a.source ?? ""],
      href: "/sync/documents",
      anchor: `assertion-${a.id}`,
    }));
  }, [graph]);
  const documentItems = useMemo<CommandItem[]>(() => {
    return documents.map((d) => ({
      id: makeCommandId("sync.document", d.id),
      kind: "document" as const,
      label: d.title,
      subtitle: `${d.type} · ${d.assertionIds.length} variables`,
      keywords: [d.type, d.id],
      href: "/sync/documents",
      anchor: `doc-${d.id}`,
    }));
  }, [documents]);
  useRegisterCommandSource("sync.assertions", assertionItems);
  useRegisterCommandSource("sync.documents", documentItems);

  const value: SyncCtx = {
    graph,
    report,
    violations,
    documents,
    assertionsById,
    patch,
    computing,
    undoLog,
    conflictsCount: violations.length,
    hardConflicts: report.hardViolations,
    softConflicts: report.softViolations,
    hasPatch: !!patch,
    patchChanges: patch?.changes.length ?? 0,
    documentsCount: documents.length,
    historyCount: undoLog.length,
    compile,
    applyCurrentPatch,
    discardPatch,
    undoLast,
    resetDemo,
    projectId: graph.projectId,
  };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

/* ───────── internals ───────── */

function cloneGraph(g: DependencyGraph): DependencyGraph {
  const next = new DependencyGraph(g.projectId);
  for (const d of g.listDocuments()) next.upsertDocument(d);
  for (const a of g.listAssertions()) next.upsertAssertion(a);
  for (const c of g.listConstraints()) next.upsertConstraint(c);
  return next;
}
