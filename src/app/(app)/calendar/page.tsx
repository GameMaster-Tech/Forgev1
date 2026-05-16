"use client";

/**
 * Calendar — overview-first redesign.
 *
 * Tabs: Calendar · Tempo · Integrations · Compiler events.
 *
 * The first tab keeps a clean month grid + today's focus rail.
 * Tempo is the AI-native scheduling layer (priority queue, overload
 * heatmap, focus-block proposals). Integrations and Compiler events
 * are tucked into their own tabs to keep the main view breathable.
 */

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Plus,
  Activity,
  GitBranch,
  AlertTriangle,
  Hourglass,
  Loader2,
  RefreshCw,
  Cable,
  CheckCircle2,
  X,
  Clock,
  MapPin,
  Brain,
  Flame,
  Zap,
  Pin,
  ArrowRight,
  Layers,
  ListChecks,
} from "lucide-react";
import { buildDemoGraph, detectViolations, proposePatch } from "@/lib/sync";
import { buildDemoBlocks, mockMarketOracle, runSync } from "@/lib/pulse";
import {
  buildInsightEvents,
  connectGoogleCalendar,
  disconnectGoogleCalendar,
  listGoogleEvents,
  readGoogleState,
  type CalendarEvent,
  type CalendarView,
  type EventKind,
  type GoogleIntegrationState,
} from "@/lib/calendar";
import {
  buildDemoSchedule,
  buildDemoRoutine,
  plan,
  computeStreak,
  CONFLICT_LABELS,
  type Conflict,
  type FocusBlock,
  type Habit,
  type OverloadPrediction,
  type PlanResult,
  type CompletionEntry,
  type StreakResult,
} from "@/lib/scheduler";
import { useCalendarStream } from "@/hooks/useCalendarStream";
import { useRegisterCommandSource, makeCommandId, type CommandItem } from "@/hooks/useCommandPalette";
import { RealtimeIndicator } from "@/components/calendar/RealtimeIndicator";
import { HabitsPanel } from "@/components/calendar/HabitsPanel";
import { GoalsPanel } from "@/components/calendar/GoalsPanel";

const ease = [0.22, 0.61, 0.36, 1] as const;

const KIND_META: Record<EventKind, { label: string; tone: string; bg: string; eyebrow: string }> = {
  meeting:             { label: "Meeting",  tone: "text-cyan",   bg: "bg-cyan",   eyebrow: "Meeting" },
  deadline:            { label: "Deadline", tone: "text-rose",   bg: "bg-rose",   eyebrow: "Deadline" },
  focus:               { label: "Focus",    tone: "text-violet", bg: "bg-violet", eyebrow: "Focus block" },
  personal:            { label: "Personal", tone: "text-green",  bg: "bg-green",  eyebrow: "Personal" },
  "sync-window":       { label: "Sync",     tone: "text-violet", bg: "bg-violet", eyebrow: "Compile run" },
  "pulse-sync":        { label: "Pulse",    tone: "text-cyan",   bg: "bg-cyan",   eyebrow: "Reality sync" },
  "decay-horizon":     { label: "Decay",    tone: "text-warm",   bg: "bg-warm",   eyebrow: "Decay horizon" },
  "patch-review":      { label: "Patch",    tone: "text-violet", bg: "bg-violet", eyebrow: "Patch review due" },
  "deadline-conflict": { label: "Conflict", tone: "text-rose",   bg: "bg-rose",   eyebrow: "Deadline conflict" },
};

type Tab = "calendar" | "tempo" | "habits" | "goals" | "integrations" | "compiler";
const TABS: { key: Tab; label: string; icon: typeof Brain }[] = [
  { key: "calendar",     label: "Calendar",       icon: CalendarIcon },
  { key: "tempo",        label: "Tempo",          icon: Brain },
  { key: "habits",       label: "Habits",         icon: Flame },
  { key: "goals",        label: "Goals",          icon: Layers },
  { key: "integrations", label: "Integrations",   icon: Cable },
  { key: "compiler",     label: "Compiler events", icon: GitBranch },
];

export default function CalendarPage() {
  const [tab, setTab] = useState<Tab>("calendar");
  const [view, setView] = useState<CalendarView>("month");
  const [cursor, setCursor] = useState<Date>(() => new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [systemEvents, setSystemEvents] = useState<CalendarEvent[]>([]);
  const [googleState, setGoogleState] = useState<GoogleIntegrationState>({ status: "disconnected" });
  const [activeEvent, setActiveEvent] = useState<CalendarEvent | null>(null);
  const [newEventOpen, setNewEventOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [scheduleBundle] = useState(() => buildDemoSchedule());
  const [planResult, setPlanResult] = useState<PlanResult | null>(null);
  const [completionsByHabit, setCompletionsByHabit] = useState<Map<string, CompletionEntry[]>>(() => seedCompletions(scheduleBundle.habits));
  const [pendingHabitId, setPendingHabitId] = useState<string | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);

  // Realtime stream — opens an SSE channel to /api/realtime/calendar.
  // Falls into the "closed" state silently for unauthenticated previews;
  // the indicator still works, just shows "Idle/Closed".
  const { status: streamStatus, presence } = useCalendarStream({
    onEvent: (e) => {
      if (e.kind === "sync.complete") setLastSyncAt(e.at);
      if (e.kind === "habit.completed") setLastSyncAt(e.at);
    },
  });

  // SSR-safe hydration of integration state + seed events.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGoogleState(readGoogleState());
    setEvents(seedPersonalEvents());
  }, []);

  // Derive system events from Sync + Pulse demo state.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const g = buildDemoGraph();
      const violations = detectViolations(g);
      const patch = proposePatch(g);
      const oracle = mockMarketOracle(2026);
      await runSync({
        assertions: g.listAssertions(),
        blocks: buildDemoBlocks(),
        oracle,
        config: { projectId: g.projectId, cadence: "weekly", invalidateThreshold: 0.1, staleThreshold: 0.04, defaultProfile: { halfLifeDays: 180, floor: 0.1, ceiling: 1 } },
      });
      const rangeStart = startOfMonth(addMonths(cursor, -1));
      const rangeEnd   = endOfMonth(addMonths(cursor, 2));
      const sys = buildInsightEvents({
        projectId: g.projectId,
        assertions: g.listAssertions(),
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
  }, [cursor]);

  // Run the Tempo planner whenever the schedule bundle is ready.
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

  // Register calendar events in the command palette.
  const eventCommands = useMemo<CommandItem[]>(() => {
    return allEvents.map((e) => ({
      id: makeCommandId("calendar.event", e.id),
      kind: "calendar-event" as const,
      label: e.title,
      subtitle: `${e.kind} · ${new Date(e.start).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
      keywords: [e.kind, e.source ?? "", ...(e.attendees?.map((a) => a.email).filter((s): s is string => !!s) ?? [])],
      href: "/calendar",
      anchor: `event-${e.id}`,
      recencyAt: e.start,
    }));
  }, [allEvents]);
  useRegisterCommandSource("calendar.events", eventCommands);

  const handleConnectGoogle = async () => {
    setLoading(true);
    const next = await connectGoogleCalendar();
    setGoogleState(next);
    const range = currentRange(cursor, view);
    const fetched = await listGoogleEvents(range.start, range.end);
    setEvents((prev) => [...prev.filter((e) => e.source !== "google"), ...fetched]);
    setLoading(false);
  };
  const handleDisconnectGoogle = async () => {
    const next = await disconnectGoogleCalendar();
    setGoogleState(next);
    setEvents((prev) => prev.filter((e) => e.source !== "google"));
  };
  const handleRefreshGoogle = async () => {
    if (googleState.status !== "connected") return;
    setLoading(true);
    const range = currentRange(cursor, view);
    const fetched = await listGoogleEvents(range.start, range.end);
    setEvents((prev) => [...prev.filter((e) => e.source !== "google"), ...fetched]);
    setLoading(false);
  };

  return (
    <div className="min-h-full bg-background">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="px-6 sm:px-10 pt-10 pb-6 flex flex-col gap-6"
      >
        <div className="flex items-end justify-between gap-6 flex-wrap">
          <div className="max-w-xl">
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-2 flex items-center gap-2">
              <CalendarIcon size={11} strokeWidth={1.75} />
              Calendar · {monthLabel(cursor)}
            </p>
            <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
              The Compiler&apos;s <span className="text-violet">clock</span>.
            </h1>
            <p className="text-[13px] text-muted mt-3 leading-relaxed">
              Time and truth share one surface. Tempo schedules around your energy; Sync and Pulse keep the dates honest.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <RealtimeIndicator status={streamStatus} presence={presence} lastSyncAt={lastSyncAt} />
            {tab === "calendar" && (
              <>
                <ViewSwitcher view={view} onChange={setView} />
                <button
                  onClick={() => setNewEventOpen(true)}
                  className="flex items-center gap-2 bg-violet text-white hover:bg-violet/90 text-[11px] font-semibold uppercase tracking-[0.12em] px-5 py-2.5 transition-colors duration-150 btn-glow-violet"
                >
                  <Plus size={12} strokeWidth={2.25} />
                  New event
                </button>
              </>
            )}
          </div>
        </div>

        {tab === "calendar" && (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <Navigator cursor={cursor} setCursor={setCursor} view={view} />
            <KindLegend />
          </div>
        )}
      </motion.header>

      {/* Sub-nav */}
      <div className="border-y border-border bg-background sticky top-0 z-10">
        <div className="px-6 sm:px-10 flex items-center overflow-x-auto">
          {TABS.map((t) => {
            const active = tab === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`relative text-[11px] uppercase tracking-[0.14em] font-semibold px-4 py-3 transition-colors duration-150 inline-flex items-center gap-2 whitespace-nowrap ${active ? "text-foreground" : "text-muted hover:text-foreground"}`}
              >
                <Icon size={12} strokeWidth={2} />
                {t.label}
                {active && (
                  <motion.span
                    layoutId="calendar-tab-indicator"
                    transition={{ duration: 0.22, ease }}
                    className="absolute left-0 right-0 -bottom-px h-[2px] bg-violet"
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      <div className="px-6 sm:px-10 pt-8 pb-16">
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease }}
          >
            {tab === "calendar" && (
              <CalendarTab
                view={view}
                cursor={cursor}
                events={allEvents}
                onSelect={setActiveEvent}
              />
            )}
            {tab === "tempo" && (
              <TempoTab
                plan={planResult}
                onOpenIntegrations={() => setTab("integrations")}
              />
            )}
            {tab === "integrations" && (
              <IntegrationsTab
                state={googleState}
                loading={loading}
                onConnect={handleConnectGoogle}
                onDisconnect={handleDisconnectGoogle}
                onRefresh={handleRefreshGoogle}
              />
            )}
            {tab === "habits" && (
              <HabitsPanel
                habits={scheduleBundle.habits}
                completionsByHabit={completionsByHabit}
                streaks={streaksFor(scheduleBundle.habits, completionsByHabit)}
                pendingHabitId={pendingHabitId}
                onComplete={(habitId) => {
                  setPendingHabitId(habitId);
                  // Optimistic update — record today's completion locally.
                  const today = new Date().toISOString().slice(0, 10);
                  setCompletionsByHabit((prev) => {
                    const next = new Map(prev);
                    const arr = next.get(habitId) ?? [];
                    if (!arr.some((c) => c.date === today)) {
                      next.set(habitId, [...arr, { date: today, at: Date.now() }]);
                    }
                    return next;
                  });
                  // Fire the server (no-op in unauthenticated preview).
                  void fetch(`/api/calendar/habits/${habitId}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
                    .catch(() => {})
                    .finally(() => setPendingHabitId(null));
                }}
                onUndo={(habitId, date) => {
                  setCompletionsByHabit((prev) => {
                    const next = new Map(prev);
                    const arr = (next.get(habitId) ?? []).filter((c) => c.date !== date);
                    next.set(habitId, arr);
                    return next;
                  });
                  void fetch(`/api/calendar/habits/${habitId}/complete?date=${date}`, { method: "DELETE" }).catch(() => {});
                }}
              />
            )}
            {tab === "goals" && (
              <GoalsPanel goals={scheduleBundle.goals} plan={planResult} />
            )}
            {tab === "compiler" && (
              <CompilerEventsTab events={systemEvents} onSelect={setActiveEvent} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {activeEvent && <EventDrawer event={activeEvent} onClose={() => setActiveEvent(null)} />}
        {newEventOpen && (
          <NewEventModal
            cursor={cursor}
            onClose={() => setNewEventOpen(false)}
            onCreate={(e) => {
              setEvents((prev) => [...prev, e]);
              setNewEventOpen(false);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/* ───────────── Calendar tab ───────────── */

function CalendarTab({ view, cursor, events, onSelect }: { view: CalendarView; cursor: Date; events: CalendarEvent[]; onSelect: (e: CalendarEvent) => void }) {
  return (
    <div className="max-w-6xl mx-auto">
      {view === "month"   && <MonthGrid cursor={cursor} events={events} onSelect={onSelect} />}
      {view === "week"    && <WeekGrid cursor={cursor} events={events} onSelect={onSelect} />}
      {view === "day"     && <DayGrid cursor={cursor} events={events} onSelect={onSelect} />}
      {view === "agenda"  && <AgendaList cursor={cursor} events={events} onSelect={onSelect} />}
      {view === "horizon" && <HorizonView events={events} onSelect={onSelect} />}
    </div>
  );
}

/* ───────────── Tempo tab ───────────── */

function TempoTab({ plan, onOpenIntegrations }: { plan: PlanResult | null; onOpenIntegrations: () => void }) {
  if (!plan) {
    return <div className="border border-border bg-surface py-16 text-center text-muted text-[14px]">Planning your week…</div>;
  }
  return (
    <div className="max-w-5xl mx-auto space-y-10">
      <TempoVerdict plan={plan} />

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-x-10 gap-y-8">
        <div className="lg:col-span-7">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
            <Flame size={11} /> Priority queue · top 5
          </p>
          <PriorityQueue plan={plan} />
        </div>
        <div className="lg:col-span-5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
            <Activity size={11} /> Overload heatmap · 7 days
          </p>
          <OverloadHeatmap predictions={plan.overload} />
          <button
            onClick={onOpenIntegrations}
            className="mt-4 w-full text-left border border-border bg-surface px-4 py-3 hover:bg-violet/[0.04] hover:border-violet transition-colors group"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase tracking-[0.15em] text-muted font-semibold mb-0.5">Connect a calendar</div>
                <div className="text-[12.5px] text-foreground font-medium">Improve predictions with real events.</div>
              </div>
              <ArrowRight size={12} className="text-muted group-hover:text-violet group-hover:translate-x-1 transition-all" />
            </div>
          </button>
        </div>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-12 gap-x-10 gap-y-8">
        <div className="lg:col-span-7">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
            <Layers size={11} /> Focus blocks Tempo placed for you
          </p>
          <FocusBlockList blocks={(plan.newBlocks ?? []).filter((b): b is FocusBlock => b.kind === "focus-block")} />
        </div>
        <div className="lg:col-span-5 space-y-6">
          <ConflictsCard conflicts={plan.conflicts} />
          <UnscheduledCard unscheduled={plan.unscheduled} />
        </div>
      </section>
    </div>
  );
}

function TempoVerdict({ plan }: { plan: PlanResult }) {
  const highSev = plan.conflicts.filter((c) => c.severity === "high").length;
  const overload = plan.overload.find((d) => d.level >= 3);
  const placed = plan.newBlocks.length;
  const headline = highSev > 0
    ? <><span className="text-rose">{highSev} hard conflict{highSev === 1 ? "" : "s"}</span> in the way.</>
    : overload
    ? <><span className="text-warm">{overload.date.slice(5)}</span> is overcommitted.</>
    : <>Your week is <span className="text-violet">compiled</span>.</>;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease }}
      className="border border-border bg-foreground text-background p-6 relative overflow-hidden"
    >
      <span aria-hidden className="absolute top-0 left-0 w-[2px] h-full bg-violet" />
      <div className="flex items-center gap-2 mb-3">
        <Brain size={12} strokeWidth={2.25} className="text-violet" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-background/60 font-medium">Tempo · last plan</span>
      </div>
      <h2 className="font-display font-bold text-[22px] tracking-[-0.02em] leading-[1.15]">
        {headline}
      </h2>
      <p className="text-[13px] text-background/70 leading-relaxed mt-2">{plan.summary}</p>
      <div className="mt-4 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.12em] font-medium">
        <Pill icon={<Layers size={10} />} label={`${placed} focus blocks`} tone="violet" />
        <Pill icon={<AlertTriangle size={10} />} label={`${plan.conflicts.length} conflicts`} tone={plan.conflicts.length === 0 ? "green" : "rose"} />
        <Pill icon={<Hourglass size={10} />} label={`${plan.unscheduled.length} unplaced`} tone={plan.unscheduled.length === 0 ? "green" : "warm"} />
        <Pill icon={<Clock size={10} />} label={new Date(plan.plannedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} tone="muted" />
      </div>
    </motion.div>
  );
}

function Pill({ icon, label, tone }: { icon: React.ReactNode; label: string; tone: "violet" | "rose" | "green" | "warm" | "muted" }) {
  const colour =
    tone === "violet" ? "text-violet"
    : tone === "rose"  ? "text-rose"
    : tone === "green" ? "text-green"
    : tone === "warm"  ? "text-warm"
    : "text-background/60";
  return (
    <span className={`inline-flex items-center gap-1 border border-white/[0.1] bg-white/[0.04] px-2 py-1 ${colour}`}>
      {icon} {label}
    </span>
  );
}

function PriorityQueue({ plan }: { plan: PlanResult }) {
  const tasksAndEvents = useMemo(() => {
    const items = plan.items.filter((i) => i.kind === "task" || i.kind === "event");
    return [...items].sort((a, b) => b.priority.score - a.priority.score).slice(0, 5);
  }, [plan]);
  return (
    <ul className="border border-border bg-surface divide-y divide-border">
      {tasksAndEvents.map((item, i) => (
        <li key={item.id} className="px-4 py-3.5">
          <div className="flex items-start gap-3">
            <span className="font-display font-bold text-muted text-[12px] tabular-nums tracking-tight pt-0.5 shrink-0 w-6">{String(i + 1).padStart(2, "0")}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-cyan inline-flex items-center gap-1">
                  <Zap size={10} /> P{Math.round(item.priority.score)}
                </span>
                <span className="text-[10px] text-muted">·</span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium">{item.kind}</span>
                <span className="text-[10px] text-muted">·</span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium">{item.energy}</span>
              </div>
              <div className="text-[14px] font-medium text-foreground truncate">{item.title}</div>
              {item.priority.factors.length > 0 && (
                <p className="text-[11.5px] text-muted leading-relaxed mt-0.5">
                  {item.priority.factors.slice(0, 2).map((f) => f.reason).join(" · ")}
                </p>
              )}
            </div>
          </div>
        </li>
      ))}
      {tasksAndEvents.length === 0 && (
        <li className="px-4 py-6 text-center text-muted text-[13px]">No active items.</li>
      )}
    </ul>
  );
}

function OverloadHeatmap({ predictions }: { predictions: OverloadPrediction[] }) {
  const tone = (level: number) => {
    if (level === 0) return "bg-green/30";
    if (level === 1) return "bg-green";
    if (level === 2) return "bg-warm/60";
    if (level === 3) return "bg-warm";
    return "bg-rose";
  };
  return (
    <div className="border border-border bg-surface px-4 py-3">
      <div className="grid grid-cols-7 gap-1.5">
        {predictions.slice(0, 7).map((p) => (
          <div key={p.date} className="flex flex-col items-center gap-1.5">
            <div className="text-[10px] uppercase tracking-[0.1em] text-muted font-semibold tabular-nums">
              {new Date(p.date).toLocaleDateString("en-US", { weekday: "narrow" })}
            </div>
            <div
              className={`w-full h-12 ${tone(p.level)} relative group cursor-help`}
              title={`${p.date}: ${Math.round(p.committedMinutes / 60 * 10) / 10}h / ${Math.round(p.capacityMinutes / 60)}h${p.reasons.length ? ` — ${p.reasons.join(", ")}` : ""}`}
            >
              <div className="absolute inset-0 flex items-center justify-center text-[10px] font-display font-bold tabular-nums text-foreground">
                {Math.round(p.load * 100)}%
              </div>
            </div>
            <div className="text-[10px] uppercase tracking-[0.1em] text-muted tabular-nums">
              {new Date(p.date).getDate()}
            </div>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-muted mt-3 leading-relaxed">Predicted load vs your usual capacity. Tempo proactively flags days {">"} 110%.</p>
    </div>
  );
}

function FocusBlockList({ blocks }: { blocks: FocusBlock[] }) {
  if (blocks.length === 0) {
    return <div className="border border-border bg-surface py-10 text-center text-muted text-[13px]">No focus blocks needed — your tasks fit the existing free time.</div>;
  }
  return (
    <ul className="border border-border bg-surface divide-y divide-border">
      {blocks.slice(0, 6).map((b) => (
        <li key={b.id} className="px-4 py-3.5">
          <div className="flex items-start gap-3">
            <span className="w-1 h-12 bg-violet shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-violet">{b.energy}</span>
                <span className="text-[10px] text-muted">·</span>
                <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
                  {new Date(b.start).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" })} · {b.durationMinutes} min
                </span>
              </div>
              <div className="text-[14px] font-medium text-foreground">{b.title}</div>
              {b.placementRationale && b.placementRationale.length > 0 && (
                <p className="text-[11px] text-muted leading-relaxed mt-1">
                  <Pin size={9} className="inline mr-1 align-middle" /> {b.placementRationale.join(" · ")}
                </p>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function ConflictsCard({ conflicts }: { conflicts: Conflict[] }) {
  const top = conflicts.slice(0, 3);
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
        <AlertTriangle size={11} /> Conflicts
      </p>
      {top.length === 0 ? (
        <div className="border border-border bg-surface py-6 px-4 text-center text-muted text-[13px]">
          Clean. Nothing fights for the same slot.
        </div>
      ) : (
        <ul className="border border-border bg-surface divide-y divide-border">
          {top.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-0.5">
                <span className={`w-1.5 h-1.5 ${c.severity === "high" ? "bg-rose" : c.severity === "medium" ? "bg-warm" : "bg-muted"}`} />
                <span className="text-[10px] uppercase tracking-[0.15em] font-semibold text-foreground">{CONFLICT_LABELS[c.kind]}</span>
              </div>
              <p className="text-[12px] text-foreground leading-relaxed">{c.message}</p>
              {c.suggestion && <p className="text-[11px] text-muted leading-relaxed mt-1">→ {c.suggestion}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function UnscheduledCard({ unscheduled }: { unscheduled: PlanResult["unscheduled"] }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-3 flex items-center gap-2">
        <ListChecks size={11} /> Couldn&apos;t fit
      </p>
      {unscheduled.length === 0 ? (
        <div className="border border-border bg-surface py-6 px-4 text-center text-muted text-[13px]">All tasks placed.</div>
      ) : (
        <ul className="border border-border bg-surface divide-y divide-border">
          {unscheduled.slice(0, 4).map(({ item, reason }) => (
            <li key={item.id} className="px-4 py-3">
              <div className="text-[12px] font-medium text-foreground truncate">{item.title}</div>
              <p className="text-[11px] text-muted leading-relaxed mt-0.5">{reason}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────────── Integrations tab ───────────── */

function IntegrationsTab({ state, loading, onConnect, onDisconnect, onRefresh }: {
  state: GoogleIntegrationState;
  loading: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefresh: () => void;
}) {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h2 className="font-display font-bold text-[22px] tracking-[-0.02em] text-foreground mb-2">Connect your calendars.</h2>
        <p className="text-[13px] text-muted leading-relaxed">Tempo learns your routine from real history. The more events it sees, the better the focus-block placement and overload predictions.</p>
      </div>
      <div className="border border-border bg-surface divide-y divide-border">
        <IntegrationRow
          name="Google Calendar"
          status={state.status}
          email={state.account?.email}
          lastSyncedAt={state.lastSyncedAt}
          loading={loading}
          onConnect={onConnect}
          onDisconnect={onDisconnect}
          onRefresh={onRefresh}
          description="OAuth · bidirectional sync · conflict resolver"
        />
        <IntegrationRow
          name="Outlook · Microsoft 365"
          status="disconnected"
          disabled
          description="Microsoft Graph API · coming soon"
        />
        <IntegrationRow
          name="iCloud · CalDAV"
          status="disconnected"
          disabled
          description="Read-only via Apple CalDAV · coming soon"
        />
        <IntegrationRow
          name="Notion Calendar"
          status="disconnected"
          disabled
          description="Two-way Notion DB sync · coming soon"
        />
      </div>
      <SyncPolicyCard />
    </div>
  );
}

function IntegrationRow({
  name, status, email, lastSyncedAt, loading, onConnect, onDisconnect, onRefresh, disabled, description,
}: {
  name: string;
  status: GoogleIntegrationState["status"];
  email?: string;
  lastSyncedAt?: string;
  loading?: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onRefresh?: () => void;
  disabled?: boolean;
  description: string;
}) {
  const connected = status === "connected";
  return (
    <div className="px-5 py-4 flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-[15px] text-foreground font-medium truncate flex items-center gap-2">
          {name}
          {connected && <CheckCircle2 size={12} className="text-green" />}
        </div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted font-medium truncate mt-0.5">
          {disabled ? description : connected ? `${email} · synced ${lastSyncedAt ? new Date(lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—"}` : description}
        </div>
      </div>
      {disabled ? (
        <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted">Soon</span>
      ) : connected ? (
        <div className="flex items-center gap-1.5">
          <button onClick={onRefresh} className="border border-border w-8 h-8 flex items-center justify-center text-muted hover:text-foreground hover:border-violet transition-colors" aria-label="Refresh">
            {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          </button>
          <button onClick={onDisconnect} className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-rose px-3 h-8">Disconnect</button>
        </div>
      ) : (
        <button onClick={onConnect} disabled={loading} className="bg-foreground text-background text-[10px] uppercase tracking-[0.12em] font-semibold px-4 h-8 hover:bg-violet transition-colors disabled:opacity-60 inline-flex items-center gap-1.5">
          {loading && <Loader2 size={10} className="animate-spin" />}
          Connect
        </button>
      )}
    </div>
  );
}

function SyncPolicyCard() {
  return (
    <div className="border border-border bg-foreground text-background p-5 relative overflow-hidden">
      <span aria-hidden className="absolute top-0 left-0 w-[2px] h-full bg-cyan" />
      <div className="flex items-center gap-2 mb-3">
        <Cable size={12} strokeWidth={2} className="text-cyan" />
        <span className="text-[10px] uppercase tracking-[0.18em] text-background/60 font-medium">How sync works</span>
      </div>
      <h3 className="font-display font-bold text-[17px] tracking-[-0.018em] leading-[1.25] mb-2">
        Bidirectional. <span className="text-cyan">Conflict-aware.</span>
      </h3>
      <p className="text-[12.5px] text-background/70 leading-relaxed">
        Tempo runs a three-way diff (workspace ↔ remote ↔ last-known-good). When both sides edit the same event, you choose: prefer local, prefer remote, or prefer the newer write. Rate-limit hits trigger exponential backoff with jitter.
      </p>
    </div>
  );
}

/* ───────────── Compiler events tab ───────────── */

function CompilerEventsTab({ events, onSelect }: { events: CalendarEvent[]; onSelect: (e: CalendarEvent) => void }) {
  const upcoming = events.filter((e) => new Date(e.start) >= new Date()).sort((a, b) => a.start.localeCompare(b.start));
  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h2 className="font-display font-bold text-[22px] tracking-[-0.02em] text-foreground mb-2">Compiler events.</h2>
        <p className="text-[13px] text-muted leading-relaxed">Sync windows, Pulse reality-sync runs, decay horizons, patch reviews, and deadline conflicts — every event Forge generates, in order.</p>
      </div>
      {upcoming.length === 0 ? (
        <div className="border border-border bg-surface py-12 text-center text-muted text-[13px]">Nothing scheduled. The compiler is quiet.</div>
      ) : (
        <ul className="border border-border bg-surface divide-y divide-border">
          {upcoming.map((e) => (
            <li key={e.id}>
              <button onClick={() => onSelect(e)} className="w-full text-left px-5 py-4 hover:bg-violet/[0.05] transition-colors flex items-start gap-3">
                <span className={`w-1 h-12 mt-0.5 shrink-0 ${KIND_META[e.kind].bg}`} />
                <div className="flex-1 min-w-0">
                  <div className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${KIND_META[e.kind].tone}`}>{KIND_META[e.kind].eyebrow}</div>
                  <div className="text-[15px] font-medium text-foreground truncate mt-0.5">{e.title}</div>
                  <div className="text-[11px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums mt-0.5">
                    {new Date(e.start).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    {!e.allDay && ` · ${new Date(e.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ───────────── Calendar grid views (preserved) ───────────── */

function MonthGrid({ cursor, events, onSelect }: { cursor: Date; events: CalendarEvent[]; onSelect: (e: CalendarEvent) => void }) {
  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));
  const today = new Date();
  return (
    <div className="border border-border bg-background">
      <div className="grid grid-cols-7 border-b border-border bg-surface">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold px-3 py-2 text-center border-r last:border-r-0 border-border">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const dayEvents = eventsOnDay(events, d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = sameDay(d, today);
          return (
            <div key={i} className={`min-h-[105px] border-r border-b last:border-r-0 border-border p-1.5 ${inMonth ? "bg-background" : "bg-surface/60"} relative`}>
              <div className={`flex items-center gap-1 ${inMonth ? "text-foreground" : "text-muted"}`}>
                <span className={`text-[11px] font-display font-bold tabular-nums tracking-tight ${isToday ? "bg-violet text-white px-1.5 py-0.5" : ""}`}>{d.getDate()}</span>
                {dayEvents.length > 3 && <span className="text-[9px] uppercase tracking-[0.12em] text-muted ml-auto">+{dayEvents.length - 3}</span>}
              </div>
              <div className="mt-1 space-y-0.5">
                {dayEvents.slice(0, 3).map((e) => (
                  <button key={e.id} onClick={() => onSelect(e)} className={`w-full text-left text-[11px] truncate px-1.5 py-0.5 hover:bg-foreground hover:text-background transition-colors duration-100 ${KIND_META[e.kind].tone}`}>
                    <span className={`inline-block w-1 h-1 mr-1.5 align-middle ${KIND_META[e.kind].bg}`} />
                    {e.allDay ? e.title : `${timeFmt(e.start)} ${e.title}`}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({ cursor, events, onSelect }: { cursor: Date; events: CalendarEvent[]; onSelect: (e: CalendarEvent) => void }) {
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="border border-border bg-background">
      <div className="grid grid-cols-7 border-b border-border bg-surface">
        {days.map((d) => (
          <div key={d.toISOString()} className="text-center px-2 py-2 border-r last:border-r-0 border-border">
            <div className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold">{d.toLocaleString("en-US", { weekday: "short" })}</div>
            <div className="font-display font-bold text-[18px] tabular-nums">{d.getDate()}</div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 min-h-[480px]">
        {days.map((d) => (
          <div key={d.toISOString()} className="border-r last:border-r-0 border-border p-2 space-y-1">
            {eventsOnDay(events, d).map((e) => (
              <button key={e.id} onClick={() => onSelect(e)} className={`w-full text-left text-[11px] truncate px-1.5 py-1 hover:bg-foreground hover:text-background transition-colors duration-100 ${KIND_META[e.kind].tone} flex items-center gap-1.5`}>
                <span className={`w-1 h-1 ${KIND_META[e.kind].bg}`} />
                {e.allDay ? e.title : `${timeFmt(e.start)} ${e.title}`}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function DayGrid({ cursor, events, onSelect }: { cursor: Date; events: CalendarEvent[]; onSelect: (e: CalendarEvent) => void }) {
  const list = eventsOnDay(events, cursor).sort((a, b) => a.start.localeCompare(b.start));
  return (
    <div className="border border-border bg-background">
      <div className="px-4 py-3 border-b border-border bg-surface flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold">{cursor.toLocaleString("en-US", { weekday: "long" })}</div>
          <div className="font-display font-bold text-[22px] tabular-nums tracking-[-0.02em]">{cursor.toLocaleDateString("en-US", { month: "long", day: "numeric" })}</div>
        </div>
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted">{list.length} events</div>
      </div>
      <div className="divide-y divide-border">
        {list.length === 0 ? (
          <div className="px-4 py-10 text-center text-muted text-[13px]">Nothing scheduled. Plenty of focus available.</div>
        ) : list.map((e) => (
          <button key={e.id} onClick={() => onSelect(e)} className="w-full text-left px-4 py-3 hover:bg-violet/[0.06] transition-colors flex items-start gap-3">
            <span className={`w-1 h-10 mt-1 shrink-0 ${KIND_META[e.kind].bg}`} />
            <div className="flex-1 min-w-0">
              <div className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${KIND_META[e.kind].tone}`}>{KIND_META[e.kind].eyebrow} · {timeFmt(e.start)}</div>
              <div className="font-display font-bold text-[16px] tracking-[-0.018em] text-foreground truncate mt-0.5">{e.title}</div>
              {e.location && <div className="text-[12px] text-muted mt-0.5 inline-flex items-center gap-1"><MapPin size={10} /> {e.location}</div>}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function AgendaList({ cursor, events, onSelect }: { cursor: Date; events: CalendarEvent[]; onSelect: (e: CalendarEvent) => void }) {
  const start = startOfMonth(cursor);
  const end = endOfMonth(cursor);
  const list = events.filter((e) => {
    const d = new Date(e.start);
    return d >= start && d <= end;
  }).sort((a, b) => a.start.localeCompare(b.start));
  const grouped = new Map<string, CalendarEvent[]>();
  for (const e of list) {
    const key = new Date(e.start).toDateString();
    const arr = grouped.get(key) ?? [];
    arr.push(e);
    grouped.set(key, arr);
  }
  return (
    <div className="border border-border bg-background">
      {Array.from(grouped.entries()).map(([day, evs]) => (
        <div key={day} className="border-b last:border-b-0 border-border">
          <div className="px-4 py-2 bg-surface text-[10px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center justify-between">
            <span>{day}</span>
            <span className="tabular-nums">{evs.length}</span>
          </div>
          <div className="divide-y divide-border">
            {evs.map((e) => (
              <button key={e.id} onClick={() => onSelect(e)} className="w-full text-left px-4 py-3 hover:bg-violet/[0.06] transition-colors flex items-start gap-3">
                <span className={`w-1 h-10 mt-1 shrink-0 ${KIND_META[e.kind].bg}`} />
                <div className="flex-1 min-w-0">
                  <div className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${KIND_META[e.kind].tone}`}>{KIND_META[e.kind].eyebrow}</div>
                  <div className="font-display font-bold text-[15px] tracking-[-0.018em] text-foreground truncate mt-0.5">{e.title}</div>
                </div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums shrink-0">{e.allDay ? "All day" : timeFmt(e.start)}</div>
              </button>
            ))}
          </div>
        </div>
      ))}
      {grouped.size === 0 && <div className="py-12 text-center text-muted text-[13px]">Nothing in this month.</div>}
    </div>
  );
}

function HorizonView({ events, onSelect }: { events: CalendarEvent[]; onSelect: (e: CalendarEvent) => void }) {
  const now = new Date();
  const horizon = addDays(now, 90);
  const filtered = events
    .filter((e) => new Date(e.start) >= now && new Date(e.start) <= horizon)
    .filter((e) => e.kind === "decay-horizon" || e.kind === "patch-review" || e.kind === "deadline-conflict" || e.kind === "deadline")
    .sort((a, b) => a.start.localeCompare(b.start));
  if (filtered.length === 0) {
    return (
      <div className="border border-border bg-surface py-16 text-center">
        <Hourglass size={20} className="mx-auto text-muted mb-2" strokeWidth={1.5} />
        <p className="text-[13px] text-muted">No invalidations or critical deadlines on the 90-day horizon.</p>
      </div>
    );
  }
  return (
    <div className="border border-border bg-background">
      <div className="px-4 py-3 border-b border-border bg-surface flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold">90-day horizon · {filtered.length} events</div>
      </div>
      <ol className="relative">
        <span aria-hidden className="absolute left-[34px] top-3 bottom-3 w-px bg-border" />
        {filtered.map((e) => {
          const days = Math.max(0, Math.round((new Date(e.start).getTime() - now.getTime()) / 86_400_000));
          return (
            <li key={e.id} className="relative pl-16 pr-4 py-3 hover:bg-violet/[0.06] transition-colors">
              <span className={`absolute left-[31px] top-1/2 -translate-y-1/2 w-2 h-2 ${KIND_META[e.kind].bg} ring-2 ring-background`} />
              <button onClick={() => onSelect(e)} className="block w-full text-left">
                <div className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${KIND_META[e.kind].tone}`}>{KIND_META[e.kind].eyebrow}</div>
                <div className="font-display font-bold text-[15px] tracking-[-0.018em] text-foreground mt-0.5">{e.title}</div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums mt-0.5">In {days}d · {new Date(e.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ───────────── Header chrome ───────────── */

function Navigator({ cursor, setCursor, view }: { cursor: Date; setCursor: (d: Date) => void; view: CalendarView }) {
  const step = view === "day" ? 1 : view === "week" ? 7 : 30;
  return (
    <div className="flex items-center gap-1.5">
      <button
        onClick={() => setCursor(view === "month" ? addMonths(cursor, -1) : addDays(cursor, -step))}
        className="flex items-center justify-center w-8 h-8 border border-border text-muted hover:text-foreground hover:border-violet transition-colors"
        aria-label="Previous"
      >
        <ChevronLeft size={14} strokeWidth={1.75} />
      </button>
      <button
        onClick={() => setCursor(new Date())}
        className="border border-border text-[10px] uppercase tracking-[0.12em] font-semibold text-foreground hover:border-violet hover:text-violet px-3 h-8 transition-colors"
      >
        Today
      </button>
      <button
        onClick={() => setCursor(view === "month" ? addMonths(cursor, 1) : addDays(cursor, step))}
        className="flex items-center justify-center w-8 h-8 border border-border text-muted hover:text-foreground hover:border-violet transition-colors"
        aria-label="Next"
      >
        <ChevronRight size={14} strokeWidth={1.75} />
      </button>
    </div>
  );
}

function ViewSwitcher({ view, onChange }: { view: CalendarView; onChange: (v: CalendarView) => void }) {
  const items: { key: CalendarView; label: string }[] = [
    { key: "month",   label: "Month" },
    { key: "week",    label: "Week" },
    { key: "day",     label: "Day" },
    { key: "agenda",  label: "Agenda" },
    { key: "horizon", label: "Horizon" },
  ];
  return (
    <div className="flex border border-border">
      {items.map((it) => (
        <button
          key={it.key}
          onClick={() => onChange(it.key)}
          className={`text-[10px] uppercase tracking-[0.12em] font-semibold px-3 h-9 transition-colors duration-150 ${view === it.key ? "bg-foreground text-background" : "bg-background text-muted hover:text-foreground"}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function KindLegend() {
  const items: EventKind[] = ["meeting", "deadline", "focus", "sync-window", "pulse-sync", "decay-horizon"];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[10px] uppercase tracking-[0.12em] text-muted font-medium">
      {items.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 ${KIND_META[k].bg}`} />
          {KIND_META[k].label}
        </span>
      ))}
    </div>
  );
}

/* ───────────── drawers ───────────── */

function EventDrawer({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-foreground/30 z-40 flex items-end sm:items-center sm:justify-end"
      onClick={onClose}
    >
      <motion.div
        initial={{ x: 32, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 32, opacity: 0 }}
        transition={{ duration: 0.25, ease }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-background border-l border-border min-h-[60vh] sm:min-h-screen shadow-[0_30px_80px_-30px_rgba(0,0,0,0.45)]"
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 ${KIND_META[event.kind].bg}`} />
            <span className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${KIND_META[event.kind].tone}`}>{KIND_META[event.kind].eyebrow}</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-muted hover:text-foreground transition-colors" aria-label="Close"><X size={14} /></button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <h2 className="font-display font-bold text-[22px] tracking-[-0.022em] leading-[1.15] text-foreground">{event.title}</h2>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Clock size={12} />
              {new Date(event.start).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              {!event.allDay && <> · {timeFmt(event.start)} — {timeFmt(event.end)}</>}
              {event.allDay && <> · All day</>}
            </div>
            {event.location && <div className="flex items-center gap-2 text-[13px] text-muted"><MapPin size={12} /> {event.location}</div>}
          </div>
          {event.description && <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{event.description}</p>}
          {event.locked && <p className="text-[11px] text-muted italic">System event · generated by the Compiler · read-only.</p>}
        </div>
      </motion.div>
    </motion.div>
  );
}

function NewEventModal({ cursor, onClose, onCreate }: { cursor: Date; onClose: () => void; onCreate: (e: CalendarEvent) => void }) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(toLocalDateInput(cursor));
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [kind, setKind] = useState<EventKind>("meeting");
  const [location, setLocation] = useState("");
  function submit() {
    if (!title.trim()) return;
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const startDate = new Date(date); startDate.setHours(sh, sm, 0, 0);
    const endDate = new Date(date); endDate.setHours(eh, em, 0, 0);
    onCreate({
      id: `user_${Date.now().toString(36)}`,
      projectId: null, title: title.trim(),
      start: startDate.toISOString(), end: endDate.toISOString(),
      allDay: false, kind, source: "forge",
      location: location.trim() || undefined,
      colorToken: kind === "deadline" ? "rose" : kind === "focus" ? "violet" : "cyan",
    });
  }
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 bg-foreground/30 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }} transition={{ duration: 0.22, ease }} onClick={(e) => e.stopPropagation()} className="bg-background border border-border w-full max-w-md shadow-[0_30px_80px_-20px_rgba(0,0,0,0.4)]">
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold">New event</span>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center text-muted hover:text-foreground" aria-label="Close"><X size={14} /></button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Event title" autoFocus className="w-full font-display font-bold text-[20px] tracking-[-0.02em] bg-transparent border-b border-border focus:border-violet outline-none py-1 placeholder:text-muted" />
          <div className="grid grid-cols-3 gap-2">
            <Field label="Date"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border border-border bg-background px-2 py-1.5 text-[13px]" /></Field>
            <Field label="Start"><input type="time" value={start} onChange={(e) => setStart(e.target.value)} className="w-full border border-border bg-background px-2 py-1.5 text-[13px]" /></Field>
            <Field label="End"><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className="w-full border border-border bg-background px-2 py-1.5 text-[13px]" /></Field>
          </div>
          <Field label="Kind">
            <select value={kind} onChange={(e) => setKind(e.target.value as EventKind)} className="w-full border border-border bg-background px-2 py-1.5 text-[13px]">
              <option value="meeting">Meeting</option>
              <option value="deadline">Deadline</option>
              <option value="focus">Focus block</option>
              <option value="personal">Personal</option>
            </select>
          </Field>
          <Field label="Location (optional)">
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Zoom, room, address…" className="w-full border border-border bg-background px-2 py-1.5 text-[13px]" />
          </Field>
        </div>
        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-foreground px-3 py-2">Cancel</button>
          <button onClick={submit} disabled={!title.trim()} className="bg-violet text-white hover:bg-violet/90 disabled:opacity-60 text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2 transition-colors">Create</button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[10px] uppercase tracking-[0.15em] text-muted font-medium mb-1">{label}</span>
      {children}
    </label>
  );
}

/* ───────────── date helpers ───────────── */

function startOfMonth(d: Date): Date { const x = new Date(d); x.setDate(1); x.setHours(0, 0, 0, 0); return x; }
function endOfMonth(d: Date): Date { const x = new Date(d.getFullYear(), d.getMonth() + 1, 0); x.setHours(23, 59, 59, 999); return x; }
function addMonths(d: Date, n: number): Date { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function startOfWeek(d: Date): Date { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0, 0, 0, 0); return x; }
function sameDay(a: Date, b: Date): boolean { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function monthLabel(d: Date): string { return d.toLocaleString("en-US", { month: "long", year: "numeric" }); }
function currentRange(cursor: Date, view: CalendarView): { start: Date; end: Date } {
  if (view === "day") return { start: setStart(cursor), end: setEnd(cursor) };
  if (view === "week") { const start = startOfWeek(cursor); return { start, end: addDays(start, 6) }; }
  return { start: startOfMonth(cursor), end: endOfMonth(cursor) };
}
function setStart(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function setEnd(d: Date): Date { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }
function eventsOnDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  return events.filter((e) => sameDay(new Date(e.start), day));
}
function timeFmt(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function seedPersonalEvents(): CalendarEvent[] {
  const today = new Date();
  return [
    { id: "user_1", projectId: "demo-project", title: "Investor update draft", start: addDaysHour(today, 0, 10).toISOString(), end: addDaysHour(today, 0, 11).toISOString(), allDay: false, kind: "focus", source: "forge", colorToken: "violet" },
    { id: "user_2", projectId: "demo-project", title: "Board pre-read deadline", start: addDaysHour(today, 5, 17).toISOString(), end: addDaysHour(today, 5, 17.5).toISOString(), allDay: false, kind: "deadline", source: "forge", colorToken: "rose" },
    { id: "user_3", projectId: null, title: "Coffee w/ Priya", start: addDaysHour(today, 2, 9).toISOString(), end: addDaysHour(today, 2, 9.5).toISOString(), allDay: false, kind: "personal", source: "forge", location: "Verve", colorToken: "green" },
  ];
}
function addDaysHour(d: Date, days: number, hour: number): Date {
  const x = new Date(d); x.setDate(x.getDate() + days); x.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0); return x;
}
function toLocalDateInput(d: Date): string {
  const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, "0"); const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Seed completion history so the streak chart isn't empty on first render. */
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


