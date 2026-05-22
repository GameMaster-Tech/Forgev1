"use client";

/**
 * useImpactSimulator — orchestrates the Compiler page's "What if..." flow.
 *
 *   • `simulate(targetId, delta)` forks the active graph, runs every
 *     invariant, and stages a VisualDeltaMap + sandbox locally. The
 *     active graph is never mutated.
 *
 *   • `accept(notes)` runs the full Phase-3 pipeline:
 *       1. POST /api/forge-graph/tempo/sign  → execution token
 *       2. POST /api/forge-graph/tempo/apply → AdvancedTempoEngine runs
 *          server-side; returns post-tempo graph + TempoRunReport
 *       3. apply mutations to source collections client-side (under
 *          Firestore rules)
 *       4. write a graph snapshot + tempo-run record to Firestore
 *       5. clear the staged simulation
 *
 *   • `reject()` discards the staged simulation without touching state.
 */

import { useCallback, useMemo, useState } from "react";
import {
  ForgeSyncCompiler,
  applyDeltaToSources,
  defaultInvariants,
  saveSnapshot,
  serialiseGraph,
  deserialiseGraph,
  type ForgeGraphNode,
  type NodeId,
  type ProposedDelta,
  type SerialisedGraph,
  type VisualDeltaMap,
  type WorkspaceInvariant,
} from "@/lib/forge-graph";
import { recordRun } from "@/lib/forge-graph/tempo-runs";
import type { TempoRunReport } from "@/lib/forge-graph/tempo-advanced";
import { auth } from "@/lib/firebase/config";

interface StagedSimulation {
  deltaMap: VisualDeltaMap;
  sandbox: Map<NodeId, ForgeGraphNode>;
  targetNodeId: NodeId;
}

export interface UseImpactSimulatorOptions {
  projectId: string;
  graph: Map<NodeId, ForgeGraphNode>;
  invariants?: WorkspaceInvariant[];
}

export interface ImpactAcceptResult {
  snapshotId: string;
  runId: string;
  report: TempoRunReport;
}

export interface ImpactSimulatorApi {
  staged: StagedSimulation | null;
  simulating: boolean;
  accepting: boolean;
  acceptError: string | null;
  simulate: (targetNodeId: NodeId, delta: ProposedDelta) => StagedSimulation;
  accept: (notes?: string) => Promise<ImpactAcceptResult>;
  reject: () => void;
}

export function useImpactSimulator({
  projectId,
  graph,
  invariants,
}: UseImpactSimulatorOptions): ImpactSimulatorApi {
  const [staged, setStaged] = useState<StagedSimulation | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  const effectiveInvariants = useMemo(
    () => invariants ?? defaultInvariants(),
    [invariants],
  );

  const compiler = useMemo(
    () => new ForgeSyncCompiler(graph, effectiveInvariants),
    [graph, effectiveInvariants],
  );

  const simulate = useCallback<ImpactSimulatorApi["simulate"]>(
    (targetNodeId, delta) => {
      setSimulating(true);
      try {
        const result = compiler.generateImpactReport(targetNodeId, delta);
        const next: StagedSimulation = {
          deltaMap: result.deltaMap,
          sandbox: result.sandbox,
          targetNodeId,
        };
        setStaged(next);
        return next;
      } finally {
        setSimulating(false);
      }
    },
    [compiler],
  );

  const accept = useCallback<ImpactSimulatorApi["accept"]>(
    async (notes) => {
      if (!staged) throw new Error("No staged simulation to accept");
      const user = auth.currentUser;
      if (!user) throw new Error("Sign-in required to accept simulation");
      setAccepting(true);
      setAcceptError(null);
      try {
        const headers = await buildAuthHeaders(user);

        // 1. Sign.
        const signRes = await fetch("/api/forge-graph/tempo/sign", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            mutations: staged.deltaMap.mutations.map((m) => ({
              nodeId: m.nodeId,
              targetField: m.targetField,
              proposedValue: m.proposedValue,
            })),
          }),
        });
        if (!signRes.ok) {
          throw new Error(
            `Sign rejected (${signRes.status}): ${await safeMessage(signRes)}`,
          );
        }
        const { token } = (await signRes.json()) as { token: string };

        // 2. Apply via server-side Tempo.
        const applyRes = await fetch("/api/forge-graph/tempo/apply", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            projectId,
            graph: serialiseGraph(staged.sandbox),
            delta: staged.deltaMap,
          }),
        });
        if (!applyRes.ok) {
          throw new Error(
            `Apply rejected (${applyRes.status}): ${await safeMessage(applyRes)}`,
          );
        }
        const { graph: returned, report } = (await applyRes.json()) as {
          graph: SerialisedGraph;
          report: TempoRunReport;
        };
        const sortedGraph = deserialiseGraph(returned);

        // 3. Write back to source collections under Firestore rules.
        await applyDeltaToSources(sortedGraph, staged.deltaMap);

        // 4. Persist snapshot + run report.
        const snapshotId = await saveSnapshot(
          projectId,
          sortedGraph,
          staged.deltaMap.scenarioPrompt,
          notes,
        );
        const runId = await recordRun({
          projectId,
          snapshotId,
          scenario: staged.deltaMap.scenarioPrompt,
          report,
          acceptedBy: user.uid,
        });

        setStaged(null);
        return { snapshotId, runId, report };
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Failed to accept simulation";
        setAcceptError(message);
        throw err;
      } finally {
        setAccepting(false);
      }
    },
    [staged, projectId],
  );

  const reject = useCallback(() => {
    setStaged(null);
    setAcceptError(null);
  }, []);

  return { staged, simulating, accepting, acceptError, simulate, accept, reject };
}

async function buildAuthHeaders(
  user: { getIdToken: () => Promise<string> },
): Promise<Record<string, string>> {
  try {
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

async function safeMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? res.statusText;
  } catch {
    return res.statusText;
  }
}
