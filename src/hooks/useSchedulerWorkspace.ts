"use client";

/**
 * useSchedulerWorkspace — live scheduler bundle (events, tasks,
 * habits, goals) for the active project.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  subscribeScheduler,
  type SchedulerPayload,
} from "@/lib/firestore/scheduler";

const EMPTY: SchedulerPayload = {
  calendarEvents: [],
  events: [],
  tasks: [],
  habits: [],
  goals: [],
};

export interface UseSchedulerWorkspaceApi {
  payload: SchedulerPayload;
  loading: boolean;
  error: string | null;
  hydrated: boolean;
}

export function useSchedulerWorkspace(
  projectId: string | null,
): UseSchedulerWorkspaceApi {
  const { user } = useAuth();
  const [payload, setPayload] = useState<SchedulerPayload>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(false);
    if (!user?.uid || !projectId) {
       
      setPayload(EMPTY);
       
      setLoading(false);
      return;
    }
     
    setLoading(true);
     
    setError(null);
    const unsub = subscribeScheduler(
      { uid: user.uid, projectId },
      (next) => {
        setPayload(next);
        setLoading(false);
        setHydrated(true);
      },
      (err) => {
        setError(
          err instanceof Error ? err.message : "Couldn't load scheduler data.",
        );
        setLoading(false);
      },
    );
    return () => unsub();
  }, [user?.uid, projectId]);

  return { payload, loading, error, hydrated };
}
