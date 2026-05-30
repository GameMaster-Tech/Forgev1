"use client";

/**
 * Activity — a clean, day-grouped timeline of everything Forge + Aria did.
 *
 * Data wiring is unchanged (local in-memory log + per-user Firestore feed,
 * merged + filtered by source/timeframe). The surface is redesigned: a calm
 * header with a live count, rounded source filters with their own accent dots,
 * and a real timeline rail with source-coloured nodes grouped under day labels.
 */

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  History,
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

const SOURCE_META: Record<ActivitySource, { label: string; icon: typeof Activity; tone: string; dot: string }> = {
  sync: { label: "Sync", icon: GitBranch, tone: "text-violet", dot: "bg-violet" },
  pulse: { label: "Pulse", icon: Activity, tone: "text-cyan", dot: "bg-cyan" },
  lattice: { label: "Lattice", icon: Network, tone: "text-warm", dot: "bg-warm" },
  calendar: { label: "Calendar", icon: Calendar, tone: "text-green", dot: "bg-green" },
  habit: { label: "Habits", icon: Repeat, tone: "text-rose", dot: "bg-rose" },
  share: { label: "Sharing", icon: UsersIcon, tone: "text-foreground", dot: "bg-foreground" },
  tempo: { label: "Tempo", icon: Sparkles, tone: "text-violet", dot: "bg-violet" },
};

const TIMEFRAMES: { key: string; label: string; minutes: number | null }[] = [
  { key: "1h", label: "Last hour", minutes: 60 },
  { key: "24h", label: "Last 24h", minutes: 60 * 24 },
  { key: "7d", label: "Last 7d", minutes: 60 * 24 * 7 },
  { key: "all", label: "All time", minutes: null },
];

function dayLabel(at: number, now: number): string {
  const startOf = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const diffDays = Math.round((startOf(now) - startOf(at)) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return new Date(at).toLocaleDateString([], { weekday: "long" });
  return new Date(at).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

export default function ActivityPage() {
  const { user } = useAuth();
  const [localEvents, setLocalEvents] = useState<ActivityEvent[]>([]);
  const [remoteEvents, setRemoteEvents] = useState<ActivityEvent[]>([]);
  const [enabledSources, setEnabledSources] = useState<Set<ActivitySource>>(
    () => new Set<ActivitySource>(["sync", "pulse", "lattice", "calendar", "habit", "share", "tempo"]),
  );
  const [timeframe, setTimeframe] = useState<string>("24h");
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(handle);
  }, []);

  useEffect(() => {
    const unsub = subscribeLocal(setLocalEvents);
    return unsub;
  }, []);

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

  useEffect(() => {
    if (user) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRemoteEvents([]);
  }, [user]);

  const merged = useMemo(() => {
    const map = new Map<string, ActivityEvent>();
    for (const e of remoteEvents) map.set(e.id, e);
    for (const e of localEvents) map.set(e.id, e);
    return Array.from(map.values()).sort((a, b) => b.at - a.at);
  }, [localEvents, remoteEvents]);

  const filtered = useMemo(() => {
    const tf = TIMEFRAMES.find((t) => t.key === timeframe);
    const since = tf?.minutes != null ? now - tf.minutes * 60_000 : undefined;
    return filterEvents(merged, { sources: enabledSources, since });
  }, [merged, enabledSources, timeframe, now]);

  const groups = useMemo(() => {
    const out: { label: string; events: ActivityEvent[] }[] = [];
    let cur: { label: string; events: ActivityEvent[] } | null = null;
    for (const e of filtered) {
      const label = dayLabel(e.at, now);
      if (!cur || cur.label !== label) {
        cur = { label, events: [] };
        out.push(cur);
      }
      cur.events.push(e);
    }
    return out;
  }, [filtered, now]);

  return (
    <div className="min-h-full bg-background">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease }}
        className="px-6 sm:px-10 pt-12 pb-7 max-w-4xl mx-auto w-full"
      >
        <div className="flex items-center gap-2.5 mb-3">
          <span className="w-7 h-7 rounded-full bg-violet/10 text-violet flex items-center justify-center">
            <History size={13} strokeWidth={2} />
          </span>
          <span className="text-[10px] uppercase tracking-[0.2em] text-muted font-semibold">Activity</span>
          {filtered.length > 0 && (
            <span className="text-[10px] tabular-nums text-muted/70 ml-1">{filtered.length} events</span>
          )}
        </div>
        <h1 className="font-display font-black text-[clamp(2rem,4vw,2.9rem)] text-foreground tracking-[-0.03em] leading-[1.04]">
          Everything that happened.
        </h1>
        <p className="text-[13.5px] text-muted mt-2.5 max-w-xl leading-relaxed">
          A live, chronological trace of every change you and Aria made across your workspace.
        </p>
      </motion.header>

      {/* Filters */}
      <div className="sticky top-0 z-10 bg-background/85 backdrop-blur-md border-y border-border">
        <div className="px-6 sm:px-10 py-3.5 max-w-4xl mx-auto w-full flex items-center gap-2 flex-wrap">
          {(Object.keys(SOURCE_META) as ActivitySource[]).map((s) => {
            const meta = SOURCE_META[s];
            const active = enabledSources.has(s);
            return (
              <button
                key={s}
                onClick={() =>
                  setEnabledSources((prev) => {
                    const next = new Set(prev);
                    if (active) next.delete(s);
                    else next.add(s);
                    return next;
                  })
                }
                aria-pressed={active}
                className={`group inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-medium border transition-all ${
                  active
                    ? "border-foreground/15 bg-foreground/[0.04] text-foreground"
                    : "border-border text-muted/60 hover:text-muted hover:border-foreground/15"
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full transition-opacity ${meta.dot} ${active ? "" : "opacity-30"}`} />
                {meta.label}
              </button>
            );
          })}
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value)}
            className="ml-auto text-[11px] rounded-full border border-border bg-background px-3 py-1.5 outline-none focus:border-violet/50 text-muted"
          >
            {TIMEFRAMES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Timeline */}
      <div className="px-6 sm:px-10 py-10 max-w-4xl mx-auto w-full">
        {groups.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-10">
            {groups.map((group) => (
              <section key={group.label}>
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-[11px] uppercase tracking-[0.18em] text-foreground/70 font-semibold">
                    {group.label}
                  </h2>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <ol className="relative ml-1.5 border-l border-border">
                  <AnimatePresence initial={false}>
                    {group.events.map((e, i) => (
                      <ActivityNode key={e.id} event={e} now={now} index={i} />
                    ))}
                  </AnimatePresence>
                </ol>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ActivityNode({ event, now, index }: { event: ActivityEvent; now: number; index: number }) {
  const meta = SOURCE_META[event.source];
  const Icon = meta.icon;
  return (
    <motion.li
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22, delay: Math.min(index, 12) * 0.02, ease }}
      className="relative pl-7 pr-2 py-3.5 group"
    >
      {/* node dot on the rail */}
      <span className={`absolute -left-[5px] top-5 w-2.5 h-2.5 rounded-full ring-4 ring-background ${meta.dot}`} />

      <div className="flex items-start gap-3">
        <span className="w-7 h-7 rounded-md border border-border bg-foreground/[0.02] flex items-center justify-center shrink-0 mt-0.5">
          <Icon size={12} strokeWidth={2} className={meta.tone} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-[10px] uppercase tracking-[0.14em] font-semibold ${meta.tone}`}>{meta.label}</span>
            <span className="text-[10px] text-muted/40">·</span>
            <span className="text-[10px] tracking-[0.06em] text-muted/70 font-medium">{event.kind}</span>
            <span className="ml-auto text-[10px] tracking-[0.08em] text-muted/60 font-medium tabular-nums">
              {formatActivityTime(event.at, now)}
            </span>
          </div>
          <p className="text-[13.5px] text-foreground font-medium leading-snug mt-1">{event.title}</p>
          {event.summary && <p className="text-[12.5px] text-muted leading-relaxed mt-0.5">{event.summary}</p>}
        </div>
      </div>
    </motion.li>
  );
}

function EmptyState() {
  return (
    <div className="border border-dashed border-border rounded-[0.75rem] bg-foreground/[0.015] py-20 text-center">
      <span className="w-11 h-11 rounded-full bg-violet/10 text-violet flex items-center justify-center mx-auto mb-4">
        <History size={18} strokeWidth={1.75} />
      </span>
      <p className="text-[13px] text-foreground font-medium mb-1">Nothing here yet</p>
      <p className="text-[12.5px] text-muted leading-relaxed max-w-sm mx-auto">
        As you and Aria work, every change shows up here. Try widening the timeframe or enabling more sources.
      </p>
    </div>
  );
}
