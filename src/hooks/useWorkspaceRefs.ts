"use client";

/**
 * useWorkspaceRefs — fast in-memory search over the user's docs
 * in the active project, used by the chat composer's @ picker.
 *
 * We fetch the project's docs once (titles + ids only — no body)
 * when the project changes, then filter client-side. A 200-doc
 * project filters in <1ms per keystroke; no Firestore round-trips
 * while the user is typing.
 *
 * Returns the raw list + a `search(q)` helper that ranks by:
 *   1. exact prefix match on title (case-insensitive)
 *   2. substring match on title
 *   3. otherwise excluded
 *
 * Sub-page nesting is preserved via parentId so future sorts can
 * group by hierarchy.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase/config";
import { getProjectDocuments } from "@/lib/firebase/firestore";

export interface WorkspaceRef {
  id: string;
  title: string;
  kind: "doc";
  /** Sub-page parent — null/absent for top-level. */
  parentId?: string | null;
}

const MAX_RESULTS = 8;

export function useWorkspaceRefs(projectId: string | null): {
  loading: boolean;
  /** Filtered results — capped at 8. */
  search: (query: string) => WorkspaceRef[];
} {
  const [refs, setRefs] = useState<WorkspaceRef[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setRefs([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const uid = auth.currentUser?.uid;
      if (!uid) {
        setLoading(false);
        return;
      }
      try {
        const docs = await getProjectDocuments(projectId, uid);
        if (cancelled) return;
        setRefs(
          docs.map((d) => ({
            id: d.id,
            title: (d.title ?? "Untitled").slice(0, 120),
            kind: "doc" as const,
            parentId: d.parentId ?? null,
          })),
        );
      } catch {
        if (!cancelled) setRefs([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const search = useCallback(
    (raw: string): WorkspaceRef[] => {
      const q = raw.trim().toLowerCase();
      if (!q) return refs.slice(0, MAX_RESULTS);
      const prefix: WorkspaceRef[] = [];
      const substring: WorkspaceRef[] = [];
      for (const r of refs) {
        const t = r.title.toLowerCase();
        if (t.startsWith(q)) prefix.push(r);
        else if (t.includes(q)) substring.push(r);
      }
      return [...prefix, ...substring].slice(0, MAX_RESULTS);
    },
    [refs],
  );

  return useMemo(() => ({ loading, search }), [loading, search]);
}
