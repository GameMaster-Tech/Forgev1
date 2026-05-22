"use client";

/**
 * useInvariants — CRUD + compile hook for the Phase 4 builder.
 *
 *   • Loads persisted invariants for the active project.
 *   • Exposes add/update/remove with optimistic state.
 *   • Returns the *compiled* WorkspaceInvariant[] ready to feed into
 *     `useImpactSimulator`. Pre-merge verification just consumes this
 *     output array — no UI/state code in the compile path.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { auth } from "@/lib/firebase/config";
import {
  compileAll,
  freshConfig,
  type InvariantConfig,
  type InvariantKind,
} from "@/lib/forge-graph/invariant-dsl";
import {
  createInvariant,
  deleteInvariant,
  listProjectInvariants,
  updateInvariant,
  type PersistedInvariant,
} from "@/lib/forge-graph/invariant-store";
import type { WorkspaceInvariant } from "@/lib/forge-graph";

export interface UseInvariantsOptions {
  projectId: string;
}

export interface UseInvariantsApi {
  invariants: PersistedInvariant[];
  loading: boolean;
  error: string | null;
  compiled: WorkspaceInvariant[];
  /** Add a brand-new invariant for the given kind. Returns its id. */
  addByKind: (kind: InvariantKind) => Promise<string>;
  add: (config: InvariantConfig) => Promise<string>;
  update: (id: string, patch: Partial<InvariantConfig>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useInvariants({ projectId }: UseInvariantsOptions): UseInvariantsApi {
  const [invariants, setInvariants] = useState<PersistedInvariant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const next = await listProjectInvariants(projectId);
      if (aliveRef.current) setInvariants(next);
    } catch (err) {
      if (aliveRef.current) {
        setError(err instanceof Error ? err.message : "Failed to load invariants");
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

  const add = useCallback<UseInvariantsApi["add"]>(
    async (config) => {
      const user = auth.currentUser;
      if (!user) throw new Error("Sign-in required to save invariants");
      const id = await createInvariant({
        projectId,
        createdBy: user.uid,
        config,
      });
      await refresh();
      return id;
    },
    [projectId, refresh],
  );

  const addByKind = useCallback<UseInvariantsApi["addByKind"]>(
    async (kind) => {
      // The id is provisional — Firestore reassigns it on persistence.
      const provisionalId = `local-${Math.random().toString(36).slice(2, 9)}`;
      return add(freshConfig(kind, provisionalId));
    },
    [add],
  );

  const update = useCallback<UseInvariantsApi["update"]>(
    async (id, patch) => {
      // Optimistic local apply so the form feels instant.
      setInvariants((prev) =>
        prev.map((p) =>
          p.id === id
            ? ({ ...p, ...patch, updatedAt: Date.now() } as PersistedInvariant)
            : p,
        ),
      );
      await updateInvariant(id, patch);
      await refresh();
    },
    [refresh],
  );

  const remove = useCallback<UseInvariantsApi["remove"]>(
    async (id) => {
      setInvariants((prev) => prev.filter((p) => p.id !== id));
      await deleteInvariant(id);
      await refresh();
    },
    [refresh],
  );

  const compiled = useMemo(() => compileAll(invariants), [invariants]);

  return { invariants, loading, error, compiled, addByKind, add, update, remove, refresh };
}
