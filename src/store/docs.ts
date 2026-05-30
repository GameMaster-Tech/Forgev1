"use client";

/**
 * Docs store — a lightweight, synchronously-readable list of the signed-in
 * user's documents, so Aria can resolve "open the launch doc" / "edit the
 * onboarding doc" by name without an extra round-trip.
 *
 * Populated by useGlobalDocSearch (which already fetches the user's docs for the
 * ⌘K palette), and read by useAria.gatherContext to fill VoiceContext.recentDocs.
 */

import { create } from "zustand";

export interface RecentDoc {
  id: string;
  title: string;
  projectId: string;
}

interface DocsState {
  docs: RecentDoc[];
  setDocs: (docs: RecentDoc[]) => void;
}

export const useDocsStore = create<DocsState>((set) => ({
  docs: [],
  setDocs: (docs) => set({ docs }),
}));
