"use client";

/**
 * CalendarProvider — section-shared state for /calendar.
 *
 * The layout mounts this once and every sub-route reads from
 * useCalendar(). The dataset (personal events + system events from
 * Sync/Pulse + Google events) lives here so that swapping between
 * the Calendar grid, Tempo, Habits, Goals, Integrations, and
 * Compiler events is just a route change — never a refetch and
 * never a derivation thrash.
 *
 * Owns:
 *   • cursor / view (calendar-grid state)
 *   • personal events + Sync/Pulse-derived system events
 *   • Google integration state + connect / disconnect / refresh actions
 *   • Tempo schedule bundle + plan result
 *   • Habit completion log + complete / undo actions
 *   • Drawer + modal state (open active event, open new-event modal)
 *   • Realtime stream status
 *   • Command-palette registration for events
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { detectViolations, proposePatch } from "@/lib/sync";
import { defaultRegistry, runSync } from "@/lib/pulse";
import { useSyncWorkspace } from "@/hooks/useSyncWorkspace";
import { usePulseWorkspace } from "@/hooks/usePulseWorkspace";
import {
  buildInsightEvents,
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  listGoogleEvents,
  readGoogleState,
  refreshGoogleState,
  type CalendarEvent,
  type CalendarView,
  type GoogleIntegrationState,
} from "@/lib/calendar";
import {
  buildDemoRoutine,
  plan,
  computeStreak,
  type Goal,
  type Habit,
  type Task,
  type TimedEvent,
  type PlanResult,
  type CompletionEntry,
  type StreakResult,
} from "@/lib/scheduler";
import { useActiveProject } from "@/hooks/useActiveProject";
import { useSchedulerWorkspace } from "@/hooks/useSchedulerWorkspace";
import { useCalendarStream } from "@/hooks/useCalendarStream";
import { useRegisterCommandSource, makeCommandId, type CommandItem } from "@/hooks/useCommandPalette";
import { upsertCalendarEvent } from "@/lib/firestore/scheduler";
import { subscribeGoogleEvents } from "@/lib/firestore/google-calendar";
import { useAuth } from "@/context/AuthContext";

export interface CalendarCtx {
  /* grid state */
  cursor: Date;
  setCursor: Dispatch<SetStateAction<Date>>;
  view: CalendarView;
  setView: Dispatch<SetStateAction<CalendarView>>;

  /* events */
  events: CalendarEvent[];
  systemEvents: CalendarEvent[];
  allEvents: CalendarEvent[];
  addEvent: (e: CalendarEvent) => void;

  /* drawer + modal (used by the /calendar grid) */
  activeEvent: CalendarEvent | null;
  setActiveEvent: (e: CalendarEvent | null) => void;
  newEventOpen: boolean;
  openNewEvent: () => void;
  closeNewEvent: () => void;

  /* google integration */
  googleState: GoogleIntegrationState;
  googleLoading: boolean;
  connectGoogle: () => Promise<void>;
  disconnectGoogle: () => Promise<void>;
  refreshGoogle: () => Promise<void>;

  /* tempo */
  scheduleBundle: {
    events: TimedEvent[];
    tasks: Task[];
    habits: Habit[];
    goals: Goal[];
  };
  planResult: PlanResult | null;

  /* habits */
  completionsByHabit: Map<string, CompletionEntry[]>;
  streaksByHabit: Map<string, StreakResult>;
  pendingHabitId: string | null;
  completeHabit: (habitId: string) => void;
  undoHabit: (habitId: string, date: string) => void;

  /* realtime */
  streamStatus: ReturnType<typeof useCalendarStream>["status"];
  presence: ReturnType<typeof useCalendarStream>["presence"];
  lastSyncAt: number | null;

  /* counts (sub-nav badges) */
  tempoConflicts: number;
  habitsDueToday: number;
  goalsActive: number;
  compilerEventsCount: number;
  integrationsConnected: number;
}

const CalendarContext = createContext<CalendarCtx | null>(null);

export function useCalendar(): CalendarCtx {
  const ctx = useContext(CalendarContext);
  if (!ctx) throw new Error("useCalendar() must be called inside <CalendarProvider>");
  return ctx;
}

export function CalendarProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { projectId } = useActiveProject();
  // Live scheduler payload for the active project. Empty arrays when
  // no project / no user — calendar grid renders an empty surface.
  const { payload: schedulerPayload } = useSchedulerWorkspace(projectId);

  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [view, setView] = useState<CalendarView>("month");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [systemEvents, setSystemEvents] = useState<CalendarEvent[]>([]);
  const [googleState, setGoogleState] = useState<GoogleIntegrationState>({ status: "disconnected" });
  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null);
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  // The scheduler bundle is derived live from Firestore now. We
  // memoise to keep the identity stable across renders that don't
  // change the underlying arrays.
  const scheduleBundle = useMemo(
    () => ({
      events: schedulerPayload.events,
      tasks: schedulerPayload.tasks,
      habits: schedulerPayload.habits,
      goals: schedulerPayload.goals,
    }),
    [schedulerPayload],
  );
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [completionsByHabit, setCompletionsByHabit] = useState<Map<string, CompletionEntry[]>>(
    () => new Map(),
  );
  const [pendingHabitId, setPendingHabitId] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  // Seed (or re-seed) completion logs whenever the habit list changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCompletionsByHabit(seedCompletions(schedulerPayload.habits));
  }, [schedulerPayload.habits]);

  // Project-scoped forge events come from useSchedulerWorkspace.
  // External events flow through a separate subscription on the
  // user-wide /users/{uid}/google_events collection. Keep this as a
  // three-segment collection path; Firestore rejects the old
  // users/{uid}/calendar/events shape as an invalid collection ref.
  const [googleEvents, setGoogleEvents] = useState<CalendarEvent[]>([]);
  useEffect(() => {
    if (!user?.uid) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setGoogleEvents([]);
      return;
    }
    const unsub = subscribeGoogleEvents(
      user.uid,
      setGoogleEvents,
      (err) => console.warn("[calendar] google events subscription failed:", err),
    );
    return () => unsub();
  }, [user?.uid]);

  // Merge both streams into the local `events` list. Forge events
  // come from the project; Google events come from the user-wide
  // subscription. De-dupe by id in case the same event got mirrored.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEvents((prev) => {
      const seen = new Set<string>();
      const out: CalendarEvent[] = [];
      // Preserve any locally-added events (optimistic inserts before
      // the Firestore round-trip lands) by replaying entries the
      // server hasn't acknowledged yet.
      const localOptimistic = prev.filter(
        (e) =>
          e.source === "forge" &&
          !schedulerPayload.calendarEvents.some((s) => s.id === e.id),
      );
      for (const e of schedulerPayload.calendarEvents) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push(e);
      }
      for (const e of googleEvents) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push(e);
      }
      for (const e of localOptimistic) {
        if (seen.has(e.id)) continue;
        seen.add(e.id);
        out.push(e);
      }
      return out;
    });
  }, [schedulerPayload.calendarEvents, googleEvents]);

  const { status: streamStatus, presence } = useCalendarStream({
    onEvent: (e) => {
      if (e.kind === "sync.complete") setLastSyncAt(e.at);
      if (e.kind === "habit.completed") setLastSyncAt(e.at);
    },
  });

  // SSR-safe hydration of the Google integration state. Synchronous
  // read first (returns the cached snapshot), then async fetch from
  // /api/integrations/google/status. Personal events are no longer
  // seeded — they come from Firestore via the scheduler subscription.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGoogleState(readGoogleState());
    void refreshGoogleState().then(setGoogleState);
  }, []);

  // Live Sync + Pulse data for system-event derivation.
  const { graph: syncGraph } = useSyncWorkspace(projectId);
  const { blocks: pulseBlocks } = usePulseWorkspace(projectId);

  // Derive system events (Sync compile windows, Pulse runs, decay
  // horizons, deadline conflicts) from the live workspace state.
  // Skips the work entirely when there's no project, so empty
  // calendars stay empty.
  useEffect(() => {
    if (!projectId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSystemEvents([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const violations = detectViolations(syncGraph);
      const patch = proposePatch(syncGraph);
      await runSync({
        assertions: syncGraph.listAssertions(),
        blocks: pulseBlocks,
        oracle: defaultRegistry().asOracle(),
        config: {
          projectId: syncGraph.projectId,
          cadence: "weekly",
          invalidateThreshold: 0.1,
          staleThreshold: 0.04,
          defaultProfile: { halfLifeDays: 180, floor: 0.1, ceiling: 1 },
        },
      });
      const rangeStart = startOfMonth(addMonths(cursor, -1));
      const rangeEnd   = endOfMonth(addMonths(cursor, 2));
      const sys = buildInsightEvents({
        projectId: syncGraph.projectId,
        assertions: syncGraph.listAssertions(),
        violations,
        patch,
        pulseCadence: "weekly",
        syncCadence: "weekly",
        decayTrustThreshold: 0.45,
        rangeStart,
        rangeEnd,
      });
      if (!cancelled) setSystemEvents(sys);
    })();
    return () => { cancelled = true; };
  }, [cursor, projectId, syncGraph, pulseBlocks]);

  // Tempo plan whenever the schedule bundle changes.
  useEffect(() => {
    const routine = buildDemoRoutine(scheduleBundle.events);
    const now = Date.now();
    const result = plan({
      rangeStart: new Date(now).toISOString(),
      rangeEnd: new Date(now + 7 * 86_400_000).toISOString(),
      events: scheduleBundle.events,
      tasks: scheduleBundle.tasks,
      habits: scheduleBundle.habits,
      goals: scheduleBundle.goals,
      routine,
      now,
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlanResult(result);
  }, [scheduleBundle]);

  const allEvents = useMemo(() => [...events, ...systemEvents], [events, systemEvents]);
  const streaksByHabit = useMemo(
    () => streaksFor(scheduleBundle.habits, completionsByHabit),
    [scheduleBundle.habits, completionsByHabit],
  );

  const addEvent = useCallback(
    (e: CalendarEvent) => {
      // Optimistic local insert so the grid updates instantly.
      setEvents((prev) => [...prev, e]);
      setNewEventOpen(false);
      // Persist to Firestore so the change survives reload and
      // propagates to other tabs / members. Fire-and-forget — if the
      // write fails the subscription emit will reconcile.
      if (user?.uid && projectId && e.source !== "google") {
        void upsertCalendarEvent({ uid: user.uid, projectId }, e).catch((err) => {
          console.warn("[calendar] persist event failed:", err);
        });
      }
    },
    [user, projectId],
  );
  const openNewEvent = useCallback(() => setNewEventOpen(true), []);
  const closeNewEvent = useCallback(() => setNewEventOpen(false), []);

  const connectGoogle = useCallback(async () => {
    setGoogleLoading(true);
    const next = await connectGoogleCalendar();
    setGoogleState(next);
    const range = currentRange(cursor, view);
    const fetched = await listGoogleEvents(range.start, range.end);
    setEvents((prev) => [...prev.filter((e) => e.source !== "google"), ...fetched]);
    setGoogleLoading(false);
  }, [cursor, view]);

  const disconnectGoogle = useCallback(async () => {
    const next = await disconnectGoogleCalendar();
    setGoogleState(next);
    setEvents((prev) => prev.filter((e) => e.source !== "google"));
  }, []);

  const refreshGoogle = useCallback(async () => {
    if (googleState.status !== "connected") return;
    setGoogleLoading(true);
    const range = currentRange(cursor, view);
    const fetched = await listGoogleEvents(range.start, range.end);
    setEvents((prev) => [...prev.filter((e) => e.source !== "google"), ...fetched]);
    setGoogleLoading(false);
  }, [cursor, view, googleState.status]);

  const completeHabit = useCallback((habitId: string) => {
    setPendingHabitId(habitId);
    const today = new Date().toISOString().slice(0, 10);
    setCompletionsByHabit((prev) => {
      const next = new Map(prev);
      const arr = next.get(habitId) ?? [];
      if (!arr.some((c) => c.date === today)) {
        next.set(habitId, [...arr, { date: today, at: Date.now() }]);
      }
      return next;
    });
    void fetch(`/api/calendar/habits/${habitId}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .catch(() => {})
      .finally(() => setPendingHabitId(null));
  }, []);

  const undoHabit = useCallback((habitId: string, date: string) => {
    setCompletionsByHabit((prev) => {
      const next = new Map(prev);
      const arr = (next.get(habitId) ?? []).filter((c) => c.date !== date);
      next.set(habitId, arr);
      return next;
    });
    void fetch(`/api/calendar/habits/${habitId}/complete?date=${date}`, { method: "DELETE" }).catch(() => {});
  }, []);

  /* counts for sub-nav badges */
  const tempoConflicts = planResult?.conflicts.length ?? 0;
  const habitsDueToday = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return scheduleBundle.habits.filter((h) => {
      if (h.archivedAt) return false;
      const done = (completionsByHabit.get(h.id) ?? []).some((c) => c.date === today);
      return !done;
    }).length;
  }, [scheduleBundle.habits, completionsByHabit]);
  const goalsActive = scheduleBundle.goals.filter((g) => g.status === "active").length;
  const compilerEventsCount = useMemo(() => {
    const now = new Date();
    return systemEvents.filter((e) => new Date(e.start) >= now).length;
  }, [systemEvents]);
  const integrationsConnected = googleState.status === "connected" ? 1 : 0;

  /* command palette: register events */
  const eventCommands = useMemo<CommandItem[]>(() => {
    return allEvents.map((e) => ({
      id: makeCommandId("calendar.event", e.id),
      kind: "calendar-event" as const,
      label: e.title,
      subtitle: `${e.kind} · ${new Date(e.start).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
      keywords: [
        e.kind,
        e.source ?? "",
        ...(e.attendees?.map((a) => a.email).filter((s): s is string => !!s) ?? []),
      ],
      href: "/calendar",
      anchor: `event-${e.id}`,
      recencyAt: e.start,
    }));
  }, [allEvents]);
  useRegisterCommandSource("calendar.events", eventCommands);

  const value: CalendarCtx = {
    cursor,
    setCursor,
    view,
    setView,
    events,
    systemEvents,
    allEvents,
    addEvent,
    activeEvent,
    setActiveEvent,
    newEventOpen,
    openNewEvent,
    closeNewEvent,
    googleState,
    googleLoading,
    connectGoogle,
    disconnectGoogle,
    refreshGoogle,
    scheduleBundle,
    planResult,
    completionsByHabit,
    streaksByHabit,
    pendingHabitId,
    completeHabit,
    undoHabit,
    streamStatus,
    presence,
    lastSyncAt,
    tempoConflicts,
    habitsDueToday,
    goalsActive,
    compilerEventsCount,
    integrationsConnected,
  };

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

/* ───────── internals ───────── */

function startOfMonth(d: Date): Date { const x = new Date(d); x.setDate(1); x.setHours(0, 0, 0, 0); return x; }
function endOfMonth(d: Date): Date { const x = new Date(d.getFullYear(), d.getMonth() + 1, 0); x.setHours(23, 59, 59, 999); return x; }
function addMonths(d: Date, n: number): Date { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d: Date): Date { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0, 0, 0, 0); return x; }

function currentRange(cursor: Date, view: CalendarView): { start: Date; end: Date } {
  if (view === "day") {
    const s = new Date(cursor); s.setHours(0, 0, 0, 0);
    const e = new Date(cursor); e.setHours(23, 59, 59, 999);
    return { start: s, end: e };
  }
  if (view === "week") {
    const start = startOfWeek(cursor);
    return { start, end: addDays(start, 6) };
  }
  return { start: startOfMonth(cursor), end: endOfMonth(cursor) };
}

function seedCompletions(habits: Habit[]): Map<string, CompletionEntry[]> {
  const map = new Map<string, CompletionEntry[]>();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const h of habits) {
    const entries: CompletionEntry[] = [];
    const daysBack = Math.min(60, Math.max(0, h.streak));
    for (let i = 1; i <= daysBack; i++) {
      const d = new Date(today.getTime() - i * 86_400_000);
      entries.push({ date: d.toISOString().slice(0, 10), at: d.getTime() });
    }
    map.set(h.id, entries);
  }
  return map;
}

function streaksFor(habits: Habit[], completions: Map<string, CompletionEntry[]>): Map<string, StreakResult> {
  const out = new Map<string, StreakResult>();
  for (const h of habits) {
    out.set(h.id, computeStreak(h, completions.get(h.id) ?? []));
  }
  return out;
}
