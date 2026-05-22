"use client";

/**
 * useTempoRuns — fetches the persisted run history for a project from
 * /api/forge-graph/tempo/runs. The endpoint is auth-gated and uses
 * the Firebase Admin SDK so the read bypasses client-side composite
 * index latency for first-time projects.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase/config";
import type { TempoRunReport } from "@/lib/forge-graph/tempo-advanced";

export interface TempoRunRecord {
  id: string;
  projectId: string;
  snapshotId: string;
  scenario: string;
  report: TempoRunReport;
  acceptedBy: string;
  createdAt: number;
}

export interface UseTempoRunsApi {
  runs: TempoRunRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  try {
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

export function useTempoRuns(projectId: string | null): UseTempoRunsApi {
  const [runs, setRuns] = useState<TempoRunRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      const res = await fetch(
        `/api/forge-graph/tempo/runs?projectId=${encodeURIComponent(projectId)}`,
        { headers, cache: "no-store" },
      );
      if (!res.ok) {
        setError(`Failed to load runs (${res.status})`);
        return;
      }
      const data = (await res.json()) as { runs?: TempoRunRecord[] };
      if (aliveRef.current) setRuns(data.runs ?? []);
    } catch (err) {
      if (aliveRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load runs");
      }
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    return () => {
      aliveRef.current = false;
    };
  }, [refresh]);

  return { runs, loading, error, refresh };
}
