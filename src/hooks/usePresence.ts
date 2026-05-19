"use client";

/**
 * usePresence — light wrapper over useCollab that exposes ONLY the
 * peer list + activity stamp.
 *
 * Use in non-editing surfaces (PresenceStrip in the AppShell, status
 * indicators) where you don't need the Y.Doc itself.
 */

import { useCollab } from "./useCollab";
import type { CollabDocId, PresenceState } from "@/lib/collab";

export interface UsePresenceResult {
  peers: PresenceState[];
  status: ReturnType<typeof useCollab> extends infer T ? (T extends { status: infer S } ? S : never) : never;
  hydrating: boolean;
}

export function usePresence(id: CollabDocId | null): UsePresenceResult {
  const collab = useCollab(id);
  return {
    peers: collab?.peers ?? [],
    status: collab?.status ?? "idle",
    hydrating: collab?.hydrating ?? true,
  };
}
