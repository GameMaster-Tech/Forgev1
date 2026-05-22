"use client";

/**
 * usePulseWorkspace — live ContentBlocks for the active project.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { subscribePulse } from "@/lib/firestore/pulse";
import type { ContentBlock } from "@/lib/pulse";

export interface UsePulseWorkspaceApi {
  blocks: ContentBlock[];
  loading: boolean;
  error: string | null;
  hydrated: boolean;
}

export function usePulseWorkspace(
  projectId: string | null,
): UsePulseWorkspaceApi {
  const { user } = useAuth();
  const [blocks, setBlocks] = useState<ContentBlock[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(false);
    if (!user?.uid || !projectId) {
       
      setBlocks([]);
       
      setLoading(false);
      return;
    }
     
    setLoading(true);
     
    setError(null);
    const unsub = subscribePulse(
      { uid: user.uid, projectId },
      (next) => {
        setBlocks(next);
        setLoading(false);
        setHydrated(true);
      },
      (err) => {
        setError(err instanceof Error ? err.message : "Couldn't load Pulse data.");
        setLoading(false);
      },
    );
    return () => unsub();
  }, [user?.uid, projectId]);

  return { blocks, loading, error, hydrated };
}
