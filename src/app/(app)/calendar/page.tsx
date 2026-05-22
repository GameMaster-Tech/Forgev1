"use client";

/**
 * Calendar — main grid.
 *
 * The user said the grid view itself looks good — only the
 * list-style subpages needed a redesign. So this page preserves the
 * existing month / week / day / agenda / horizon implementations and
 * just wires them into the section-shared <CalendarProvider>.
 * The control strip (Navigator + ViewSwitcher + KindLegend) lives
 * on this page (not the layout) because it's only relevant to the
 * grid view.
 */

import { useRef, useState } from "react";
import { motion } from "framer-motion";
import { Hourglass, MapPin } from "lucide-react";
import { AgendaList } from "@/components/calendar/grids/AgendaList";
import type { CalendarEvent } from "@/lib/calendar";
import { useCalendar } from "./CalendarProvider";
import {
  KIND_META,
  KindLegend,
  Navigator,
  ViewSwitcher,
  addDays,
  eventsOnDay,
  monthLabel,
  sameDay,
  startOfMonth,
  startOfWeek,
  timeFmt,
  ease,
} from "./_components";

export default function CalendarGridPage() {
  const { view, setView, cursor, setCursor, allEvents, setActiveEvent } = useCalendar();

  return (
    <div className="px-6 sm:px-10 pt-8 pb-16">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease }}
        className="flex items-center justify-between gap-3 flex-wrap mb-5"
      >
        <div className="flex items-center gap-3 flex-wrap">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted font-medium tabular-nums">
            {monthLabel(cursor)}
          </p>
          <Navigator cursor={cursor} setCursor={setCursor} view={view} />
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <ViewSwitcher view={view} onChange={setView} />
        </div>
      </motion.div>

      <div className="mb-4">
        <KindLegend />
      </div>

      <div className="max-w-6xl">
        {view === "month"   && <MonthGrid cursor={cursor} events={allEvents} onSelect={setActiveEvent} />}
        {view === "week"    && <WeekGrid  cursor={cursor} events={allEvents} onSelect={setActiveEvent} />}
        {view === "day"     && <DayGrid   cursor={cursor} events={allEvents} onSelect={setActiveEvent} />}
        {view === "agenda"  && <AgendaList cursor={cursor} events={allEvents} onSelect={setActiveEvent} />}
        {view === "horizon" && <HorizonView events={allEvents} onSelect={setActiveEvent} />}
      </div>
    </div>
  );
}

/* ────────────── Month grid (preserved) ────────────── */

function MonthGrid({ cursor, events, onSelect }: { cursor: Date; events: CalendarEvent[]; onSelect: (e: CalendarEvent) => void }) {
  const monthStart = startOfMonth(cursor);
  const gridStart = startOfWeek(monthStart);
  const cells: Date[] = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));
  const today = new Date();

  const initialFocus = cells.findIndex((d) => sameDay(d, today));
  const [focusedIndex, setFocusedIndex] = useState<number>(initialFocus >= 0 ? initialFocus : 0);
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKey = (e: React.KeyboardEvent<HTMLDivElement>, i: number) => {
    let next = i;
    switch (e.key) {
      case "ArrowLeft":  next = Math.max(0, i - 1); break;
      case "ArrowRight": next = Math.min(cells.length - 1, i + 1); break;
      case "ArrowUp":    next = Math.max(0, i - 7); break;
      case "ArrowDown":  next = Math.min(cells.length - 1, i + 7); break;
      case "Home":       next = i - (i % 7); break;
      case "End":        next = i - (i % 7) + 6; break;
      case "Enter":
      case " ": {
        const dayEvents = eventsOnDay(events, cells[i]);
        if (dayEvents.length > 0) {
          e.preventDefault();
          onSelect(dayEvents[0]);
        }
        return;
      }
      default: return;
    }
    e.preventDefault();
    setFocusedIndex(next);
    cellRefs.current[next]?.focus();
  };

  return (
    <div className="border border-border bg-background">
      <div className="hidden sm:block">
        <div className="grid grid-cols-7 border-b border-border bg-surface" role="presentation">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div
              key={d}
              className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold px-3 py-2 text-center border-r last:border-r-0 border-border"
              aria-hidden
            >
              {d}
            </div>
          ))}
        </div>
        <div
          className="grid grid-cols-7"
          role="grid"
          aria-label={`Calendar · ${monthLabel(cursor)} · use arrow keys to move`}
        >
          {Array.from({ length: 6 }).map((_, rowIdx) => (
            <div key={`row-${rowIdx}`} role="row" style={{ display: "contents" }}>
              {cells.slice(rowIdx * 7, rowIdx * 7 + 7).map((d, colIdx) => {
                const i = rowIdx * 7 + colIdx;
                const dayEvents = eventsOnDay(events, d);
                const inMonth = d.getMonth() === cursor.getMonth();
                const isToday = sameDay(d, today);
                const isFocused = focusedIndex === i;
                const dateLabel = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
                return (
                  <div
                    key={i}
                    role="gridcell"
                    aria-selected={isFocused}
                    aria-label={`${dateLabel}${dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length === 1 ? "" : "s"}` : ", no events"}`}
                    tabIndex={isFocused ? 0 : -1}
                    onKeyDown={(e) => handleKey(e, i)}
                    onFocus={() => setFocusedIndex(i)}
                    ref={(el) => { cellRefs.current[i] = el as unknown as HTMLButtonElement | null; }}
                    className={`min-h-[105px] border-r border-b last:border-r-0 border-border p-1.5 ${inMonth ? "bg-background" : "bg-surface/60"} relative focus:outline-none focus-visible:ring-2 focus-visible:ring-violet focus-visible:ring-inset`}
                  >
                    <div className={`flex items-center gap-1 ${inMonth ? "text-foreground" : "text-muted"}`}>
                      <span aria-hidden className={`text-[11px] font-display font-bold tabular-nums tracking-tight ${isToday ? "bg-violet text-white px-1.5 py-0.5" : ""}`}>
                        {d.getDate()}
                      </span>
                      {dayEvents.length > 3 && (
                        <span aria-hidden className="text-[9px] uppercase tracking-[0.12em] text-muted ml-auto">
                          +{dayEvents.length - 3}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {dayEvents.slice(0, 3).map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          tabIndex={-1}
                          onClick={(ev) => { ev.stopPropagation(); onSelect(e); }}
                          aria-label={`${KIND_META[e.kind].label}: ${e.title}${e.allDay ? ", all day" : `, ${timeFmt(e.start)}`}`}
                          className={`w-full text-left text-[11px] truncate px-1.5 py-0.5 hover:bg-foreground hover:text-background transition-colors duration-100 ${KIND_META[e.kind].tone}`}
                        >
                          <span aria-hidden className={`inline-block w-1 h-1 mr-1.5 align-middle ${KIND_META[e.kind].bg}`} />
                          {e.allDay ? e.title : `${timeFmt(e.start)} ${e.title}`}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="sm:hidden">
        {cells
          .filter((d) => d.getMonth() === cursor.getMonth())
          .map((d) => ({ d, ev: eventsOnDay(events, d) }))
          .filter(({ ev }) => ev.length > 0)
          .map(({ d, ev }) => {
            const isToday = sameDay(d, today);
            return (
              <div key={d.toISOString()} className="border-b last:border-b-0 border-border">
                <div className="px-4 py-2 bg-surface flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`text-[12px] font-display font-bold tabular-nums tracking-tight ${isToday ? "bg-violet text-white px-1.5 py-0.5" : "text-foreground"}`}>
                      {d.getDate()}
                    </span>
                    <span className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold">
                      {d.toLocaleString("en-US", { weekday: "long" })}
                    </span>
                  </div>
                  <span className="text-[10px] tabular-nums text-muted">{ev.length}</span>
                </div>
                <div className="divide-y divide-border">
                  {ev.map((e) => (
                    <button
                      key={e.id}
                      onClick={() => onSelect(e)}
                      className="w-full text-left px-4 py-2.5 flex items-center gap-2 hover:bg-violet/[0.06] focus:bg-violet/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet"
                    >
                      <span aria-hidden className={`w-1 h-6 ${KIND_META[e.kind].bg} shrink-0`} />
                      <span className={`text-[10px] uppercase tracking-[0.14em] font-semibold ${KIND_META[e.kind].tone} w-14 shrink-0 tabular-nums`}>
                        {e.allDay ? "All day" : timeFmt(e.start)}
                      </span>
                      <span className="flex-1 text-[13px] text-foreground truncate">{e.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        {cells.filter((d) => d.getMonth() === cursor.getMonth()).every((d) => eventsOnDay(events, d).length === 0) && (
          <div className="py-12 text-center text-muted text-[13px]">Nothing this month.</div>
        )}
      </div>
    </div>
  );
}

/* ────────────── Week grid (preserved) ────────────── */

function WeekGrid({ cursor, events, onSelect }: { cursor: Date; events: CalendarEvent[]; onSelect: (e: CalendarEvent) => void }) {
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="border border-border bg-background overflow-x-auto">
      <div className="min-w-[640px]">
        <div className="grid grid-cols-7 border-b border-border bg-surface">
          {days.map((d) => (
            <div key={d.toISOString()} className="text-center px-2 py-2 border-r last:border-r-0 border-border">
              <div className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold">
                {d.toLocaleString("en-US", { weekday: "short" })}
              </div>
              <div className="font-display font-bold text-[18px] tabular-nums">{d.getDate()}</div>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 min-h-[480px]">
          {days.map((d) => (
            <div key={d.toISOString()} className="border-r last:border-r-0 border-border p-2 space-y-1">
              {eventsOnDay(events, d).map((e) => (
                <button
                  key={e.id}
                  onClick={() => onSelect(e)}
                  className={`w-full text-left text-[11px] truncate px-1.5 py-1 hover:bg-foreground hover:text-background focus:outline-none focus-visible:ring-2 focus-visible:ring-violet transition-colors duration-100 ${KIND_META[e.kind].tone} flex items-center gap-1.5`}
                >
                  <span aria-hidden className={`w-1 h-1 ${KIND_META[e.kind].bg}`} />
                  {e.allDay ? e.title : `${timeFmt(e.start)} ${e.title}`}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ────────────── Day grid (preserved) ────────────── */

function DayGrid({ cursor, events, onSelect }: { cursor: Date; events: CalendarEvent[]; onSelect: (e: CalendarEvent) => void }) {
  const list = eventsOnDay(events, cursor).sort((a, b) => a.start.localeCompare(b.start));
  return (
    <div className="border border-border bg-background">
      <div className="px-4 py-3 border-b border-border bg-surface flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold">
            {cursor.toLocaleString("en-US", { weekday: "long" })}
          </div>
          <div className="font-display font-bold text-[22px] tabular-nums tracking-[-0.02em]">
            {cursor.toLocaleDateString("en-US", { month: "long", day: "numeric" })}
          </div>
        </div>
        <div className="text-[10px] uppercase tracking-[0.12em] text-muted">{list.length} events</div>
      </div>
      <div className="divide-y divide-border">
        {list.length === 0 ? (
          <div className="px-4 py-10 text-center text-muted text-[13px]">
            Nothing scheduled. Plenty of focus available.
          </div>
        ) : list.map((e) => (
          <button key={e.id} onClick={() => onSelect(e)} className="w-full text-left px-4 py-3 hover:bg-violet/[0.06] transition-colors flex items-start gap-3">
            <span aria-hidden className={`w-1 h-10 mt-1 shrink-0 ${KIND_META[e.kind].bg}`} />
            <div className="flex-1 min-w-0">
              <div className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${KIND_META[e.kind].tone}`}>
                {KIND_META[e.kind].eyebrow} · {timeFmt(e.start)}
              </div>
              <div className="font-display font-bold text-[16px] tracking-[-0.018em] text-foreground truncate mt-0.5">
                {e.title}
              </div>
              {e.location && (
                <div className="text-[12px] text-muted mt-0.5 inline-flex items-center gap-1">
                  <MapPin size={10} /> {e.location}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/* ────────────── Horizon view (preserved) ────────────── */

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
        <div className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold">
          90-day horizon · {filtered.length} events
        </div>
      </div>
      <ol className="relative">
        <span aria-hidden className="absolute left-[34px] top-3 bottom-3 w-px bg-border" />
        {filtered.map((e) => {
          const days = Math.max(0, Math.round((new Date(e.start).getTime() - now.getTime()) / 86_400_000));
          return (
            <li key={e.id} className="relative pl-16 pr-4 py-3 hover:bg-violet/[0.06] transition-colors">
              <span aria-hidden className={`absolute left-[31px] top-1/2 -translate-y-1/2 w-2 h-2 ${KIND_META[e.kind].bg} ring-2 ring-background`} />
              <button onClick={() => onSelect(e)} className="block w-full text-left">
                <div className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${KIND_META[e.kind].tone}`}>
                  {KIND_META[e.kind].eyebrow}
                </div>
                <div className="font-display font-bold text-[15px] tracking-[-0.018em] text-foreground mt-0.5">
                  {e.title}
                </div>
                <div className="text-[11px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums mt-0.5">
                  In {days}d · {new Date(e.start).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </div>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
