"use client";

/**
 * useSyncWorkspace — live `DependencyGraph` for the active project.
 *
 * Subscribes to `/users/{uid}/projects/{pid}/sync_*` and folds the
 * results into a fresh `DependencyGraph`. The graph is rebuilt on
 * every emit; identity changes so React downstream selectors re-run
 * cleanly without needing to diff the internals.
 *
 * Empty state: when no user / no project is available, returns an
 * empty graph (no demo data). Callers render their own empty state.
 *
 * Error state: surfaced via `error`; the graph stays at its last good
 * snapshot so the UI doesn't flash blank during a transient outage.
 */

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  hydrateGraph,
  subscribeSync,
  type SyncSubscriptionPayload,
} from "@/lib/firestore/sync";
import { DependencyGraph } from "@/lib/sync";

const FALLBACK_PROJECT_ID = "personal";

export interface UseSyncWorkspaceApi {
  graph: DependencyGraph;
  loading: boolean;
  error: string | null;
  /**
   * `true` once at least one emit has landed for the current
   * (uid, projectId) pair. Stays `false` for the empty-state graph
   * we hand out when there's no project to subscribe to.
   */
  hydrated: boolean;
}

export function useSyncWorkspace(
  projectId: string | null,
): UseSyncWorkspaceApi {
  const { user } = useAuth();
  const [payload, setPayload] = useState<SyncSubscriptionPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.uid || !projectId) {
      // Reset when the (uid, projectId) pair becomes unresolvable.
      // This is the legitimate "external state cleared" path that
      // the React Compiler rule covers — see AuthContext.tsx for the
      // same pattern.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPayload(null);
       
      setLoading(false);
      return;
    }
     
    setLoading(true);
     
    setError(null);
    const unsub = subscribeSync(
      { uid: user.uid, projectId },
      (next) => {
        setPayload(next);
        setLoading(false);
      },
      (err) => {
        setError(err instanceof Error ? err.message : "Couldn't load sync data.");
        setLoading(false);
      },
    );
    return () => {
      unsub();
    };
  }, [user?.uid, projectId]);

  const graph = useMemo(() => {
    if (!payload) {
      // Empty graph keeps every consumer's selector safe (listAssertions
      // etc. all return empty arrays).
      return new DependencyGraph(projectId ?? FALLBACK_PROJECT_ID);
    }
    return hydrateGraph(projectId ?? FALLBACK_PROJECT_ID, payload);
  }, [payload, projectId]);

  return {
    graph,
    loading,
    error,
    hydrated: payload != null,
  };
}
