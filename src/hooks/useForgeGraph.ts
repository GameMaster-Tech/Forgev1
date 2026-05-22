"use client";

/**
 * useForgeGraph — React hook that materialises the unified ForgeGraph
 * from whichever data sources happen to be loaded in the current view.
 *
 * Inputs are all optional; the underlying `buildForgeGraph` degrades
 * cleanly when a feature surface (e.g. Tempo, Pulse) hasn't been
 * mounted yet. The hook re-derives the graph only when one of its
 * inputs identity-changes; pass already-memoised arrays from callers
 * to keep this on the cheap path.
 */

import { useMemo } from "react";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { FirestoreDocument } from "@/lib/firebase/firestore";
import type { ContentBlock } from "@/lib/pulse/types";
import type { Assertion, ConstraintEdge } from "@/lib/sync/types";
import type { Goal, Habit, Task, TimedEvent } from "@/lib/scheduler/types";
import type { Editor } from "@tiptap/react";

import {
  buildForgeGraph,
  type ForgeGraphNode,
  type NodeId,
} from "@/lib/forge-graph";

export interface UseForgeGraphInput {
  documents?: FirestoreDocument[];
  assertions?: Assertion[];
  constraints?: ConstraintEdge[];
  calendarEvents?: CalendarEvent[];
  goals?: Goal[];
  habits?: Habit[];
  tasks?: Task[];
  timedEvents?: TimedEvent[];
  pulseBlocks?: ContentBlock[];
  liveEditor?: {
    editor: Editor;
    documentId: string;
    projectId: string;
    title: string;
  };
}

export function useForgeGraph(
  input: UseForgeGraphInput,
): Map<NodeId, ForgeGraphNode> {
  // Destructure so each dep is a real identity React Compiler can track,
  // instead of `input.x` access chains which it conservatively bails on.
  const {
    documents,
    assertions,
    constraints,
    calendarEvents,
    goals,
    habits,
    tasks,
    timedEvents,
    pulseBlocks,
    liveEditor,
  } = input;
  return useMemo(
    () =>
      buildForgeGraph({
        documents,
        assertions,
        constraints,
        calendarEvents,
        goals,
        habits,
        tasks,
        timedEvents,
        pulseBlocks,
        liveEditor,
      }),
    [
      documents,
      assertions,
      constraints,
      calendarEvents,
      goals,
      habits,
      tasks,
      timedEvents,
      pulseBlocks,
      liveEditor,
    ],
  );
}
