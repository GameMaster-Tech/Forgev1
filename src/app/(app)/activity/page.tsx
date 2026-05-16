"use client";

/**
 * Activity feed page — every system event Forge emits, in reverse-chrono
 * order. Pulls from the in-memory local log (instant, no auth required)
 * AND, when a uid is available, from the per-user `activity` Firestore
 * collection so events propagate across tabs / devices.
 *
 * Filters:
 *   • Source — multi-select pills (Sync / Pulse / Lattice / Calendar / …)
 *   • Project — text input matched against `projectId`
 *   • Timeframe — last hour / last 24h / last 7d / all
 */

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  History,
  Filter,
  GitBranch,
  Activity,
  Network,
  Calendar,
  Repeat,
  Users as UsersIcon,
  Sparkles,
} from "lucide-react";
import {
  filterEvents,
  formatActivityTime,
  subscribeActivity,
  subscribeLocal,
  type ActivityEvent,
  type ActivitySource,
} from "@/lib/activity";
import { useAuth } from "@/context/AuthContext";

const ease = [0.22, 0.61, 0.36, 1] as const;

const SOURCE_META: Record<ActivitySource, { label: string; icon: typeof Activity; tone: string; bg: string }> = {
  sync:     { label: "Sync",     icon: GitBranch, tone: "text-violet", bg: "bg-violet" },
  pulse:    { label: "Pulse",    icon: Activity,  tone: "text-cyan",   bg: "bg-cyan"   },
  lattice:  { label: "Lattice",  icon: Network,   tone: "text-warm",   bg: "bg-warm"   },
  calendar: { label: "Calendar", icon: Calendar,  tone: "text-green",  bg: "bg-green"  },
  habit:    { label: "Habits",   icon: Repeat,    tone: "text-rose",   bg: "bg-rose"   },
  share:    { label: "Sharing",  icon: UsersIcon, tone: "text-foreground", bg: "bg-foreground" },
  tempo:    { label: "Tempo",    icon: Sparkles,  tone: "text-violet", bg: "bg-violet" },
};

const TIMEFRAMES: { key: string; label: string; minutes: number | null }[] = [
  { key: "1h",  label: "Last hour",  minutes: 60 },
  { key: "24h", label: "Last 24h",   minutes: 60 * 24 },
  { key: "7d",  label: "Last 7d",    minutes: 60 * 24 * 7 },
  { key: "all", label: "All time",   minutes: null },
];

export default function ActivityPage() {
  const { user } = useAuth();
  const [localEvents, setLocalEvents] = useState<ActivityEvent[]>([]);
  const [remoteEvents, setRemoteEvents] = useState<ActivityEvent[]>([]);
  const [enabledSources, setEnabledSources] = useState<Set<ActivitySource>>(
    () => new Set<ActivitySource>(["sync", "pulse", "lattice", "calendar", "habit", "share", "tempo"]),
  );
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [timeframe, setTimeframe] = useState<string>("24h");
  const [now, setNow] = useState<number>(() => Date.now());

  // Tick "now" once a minute so the relative-time labels stay fresh.
  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(handle);
  }, []);

  // Local feed — always available.
  useEffect(() => {
    const unsub = subscribeLocal(setLocalEvents);
    return unsub;
  }, []);

  // Firestore feed — only when authenticated.
  useEffect(() => {
    if (!user) return;
    const unsub = subscribeActivity({
      uid: user.uid,
      onEvents: setRemoteEvents,
      onError: (err) => console.warn("[activity] subscribe failed:", err),
      limit: 200,
    });
    return () => unsub();
  }, [user]);

  // Clear remote events when the user logs out (separate effect avoids
  // the in-effect setState lint).
  useEffect(() => {
    if (user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRemoteEvents([]);
  }, [user]);

  // Merge local + remote events, dedupe by id, sort desc.
  const merged = useMemo(() => {
    const map = new Map<string, ActivityEvent>();
    for (const e of remoteEvents) map.set(e.id, e);
    for (const e of localEvents) map.set(e.id, e); // local wins on collision
    return Array.from(map.values()).sort((a, b) => b.at - a.at);
  }, [localEvents, remoteEvents]);

  // Apply filters.
  const filtered = useMemo(() => {
    const tf = TIMEFRAMES.find((t) => t.key === timeframe);
    const since = tf?.minutes != null ? now - tf.minutes * 60_000 : undefined;
    return filterEvents(merged, {
      sources: enabledSources,
      projectId: projectFilter.trim() || undefined,
      since,
    });
  }, [merged, enabledSources, projectFilter, timeframe, now]);

  return (
    <div className="min-h-full bg-background">
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="px-6 sm:px-10 pt-10 pb-6"
      >
        <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium mb-2 flex items-center gap-2">
          <History size={11} strokeWidth={1.75} />
          Activity · everything that happened
        </p>
        <h1 className="font-display font-extrabold text-3xl sm:text-4xl text-foreground tracking-[-0.025em] leading-[1.05]">
          {filtered.length === 0 ? (
            <>No <span className="text-muted">activity</span> in this window.</>
          ) : (
            <><span className="text-violet">{filtered.length}</span> event{filtered.length === 1 ? "" : "s"} · reverse-chronological.</>
          )}
        </h1>
        <p className="text-[13px] text-muted mt-2 max-w-2xl leading-relaxed">
          Every Sync compile, Pulse run, Lattice rebranch, calendar upsert, habit completion, sharing change, and Tempo replan in one stream — filterable by source, project, and timeframe.
        </p>
      </motion.header>

      <div className="border-y border-border bg-surface/40">
        <div className="px-6 sm:px-10 py-4 flex flex-col sm:flex-row gap-3 sm:items-center flex-wrap">
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center gap-1.5">
            <Filter size={11} />
            Sources
          </span>
          {(Object.keys(SOURCE_META) as ActivitySource[]).map((s) => {
            const meta = SOURCE_META[s];
            const Icon = meta.icon;
            const active = enabledSources.has(s);
            return (
              <button
                key={s}
                onClick={() =>
                  setEnabledSources((prev) => {
                    const next = new Set(prev);
                    if (active) next.delete(s); else next.add(s);
                    return next;
                  })
                }
                className={`text-[10px] uppercase tracking-[0.12em] font-semibold px-3 py-1.5 border inline-flex items-center gap-1.5 transition-colors ${
                  active ? "border-violet bg-violet text-white" : "border-border text-muted hover:border-violet hover:text-violet"
                }`}
                aria-pressed={active}
              >
                <Icon size={10} strokeWidth={2} />
                {meta.label}
              </button>
            );
          })}
          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              placeholder="Filter by project id"
              className="text-[11px] border border-border bg-background px-2 py-1.5 outline-none focus:border-violet w-44"
            />
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value)}
              className="text-[11px] border border-border bg-background px-2 py-1.5 outline-none focus:border-violet"
            >
              {TIMEFRAMES.map((t) => (
                <option key={t.key} value={t.key}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <div className="px-6 sm:px-10 py-10 max-w-5xl mx-auto">
        {filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <ol className="border border-border divide-y divide-border bg-background">
            <AnimatePresence initial={false}>
              {filtered.map((e, i) => (
                <ActivityRow key={e.id} event={e} now={now} index={i} />
              ))}
            </AnimatePresence>
          </ol>
        )}
      </div>
    </div>
  );
}

function ActivityRow({ event, now, index }: { event: ActivityEvent; now: number; index: number }) {
  const meta = SOURCE_META[event.source];
  const Icon = meta.icon;
  return (
    <motion.li
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, delay: Math.min(index, 12) * 0.012, ease }}
      className="px-5 py-3.5 flex items-start gap-4"
    >
      <span className={`w-6 h-6 border border-border bg-background flex items-center justify-center shrink-0 mt-0.5`}>
        <Icon size={11} className={meta.tone} strokeWidth={1.75} />
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${meta.tone}`}>
            {meta.label}
          </span>
          <span className="text-[10px] text-muted">·</span>
          <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium">{event.kind}</span>
          {event.projectId && (
            <>
              <span className="text-[10px] text-muted">·</span>
              <span className="text-[10px] uppercase tracking-[0.12em] text-muted font-medium">{event.projectId}</span>
            </>
          )}
          <span className="ml-auto text-[10px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums">
            {formatActivityTime(event.at, now)}
          </span>
        </div>
        <p className="text-[13px] text-foreground font-medium leading-tight mt-1">{event.title}</p>
        <p className="text-[12.5px] text-muted leading-relaxed mt-0.5">{event.summary}</p>
      </div>
    </motion.li>
  );
}

function EmptyState() {
  return (
    <div className="border border-border bg-surface py-16 text-center">
      <History size={20} className="mx-auto text-muted mb-2" strokeWidth={1.5} />
      <p className="text-[13px] text-muted">No events match the current filters. Try widening the timeframe.</p>
    </div>
  );
}
