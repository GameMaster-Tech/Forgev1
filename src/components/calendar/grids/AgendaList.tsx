"use client";

/**
 * AgendaList — flat, time-ordered listing of every event in a range.
 *
 * Lists with more than VIRTUALIZE_THRESHOLD rows fall through to
 * react-window's virtual List so we never mount more than a handful of
 * DOM nodes. The grouped (day-header) presentation is preserved: each
 * row is either a sticky-styled day header or one event under it. This
 * keeps O(N) cost at first paint while remaining indistinguishable
 * from the static list at <100 events.
 *
 * Public surface: `<AgendaList cursor events onSelect />`. The host
 * controls the cursor (anchor month) and the click handler.
 */

import { useMemo } from "react";
import { List, type RowComponentProps } from "react-window";
import type { CalendarEvent, EventKind } from "@/lib/calendar";

const VIRTUALIZE_THRESHOLD = 100;
const ROW_HEIGHT = 72;
const HEADER_HEIGHT = 36;
const DEFAULT_HEIGHT = 600;

const KIND_META: Record<EventKind, { tone: string; bg: string; eyebrow: string }> = {
  meeting:             { tone: "text-cyan",   bg: "bg-cyan",   eyebrow: "Meeting" },
  deadline:            { tone: "text-rose",   bg: "bg-rose",   eyebrow: "Deadline" },
  focus:               { tone: "text-violet", bg: "bg-violet", eyebrow: "Focus block" },
  personal:            { tone: "text-green",  bg: "bg-green",  eyebrow: "Personal" },
  "sync-window":       { tone: "text-violet", bg: "bg-violet", eyebrow: "Compile run" },
  "pulse-sync":        { tone: "text-cyan",   bg: "bg-cyan",   eyebrow: "Reality sync" },
  "decay-horizon":     { tone: "text-warm",   bg: "bg-warm",   eyebrow: "Decay horizon" },
  "patch-review":      { tone: "text-violet", bg: "bg-violet", eyebrow: "Patch review due" },
  "deadline-conflict": { tone: "text-rose",   bg: "bg-rose",   eyebrow: "Deadline conflict" },
};

type Row =
  | { kind: "header"; day: string; count: number }
  | { kind: "event"; event: CalendarEvent };

interface AgendaListProps {
  cursor: Date;
  events: CalendarEvent[];
  onSelect: (e: CalendarEvent) => void;
}

export function AgendaList({ cursor, events, onSelect }: AgendaListProps) {
  const rows: Row[] = useMemo(() => {
    const start = startOfMonth(cursor);
    const end = endOfMonth(cursor);
    const inRange = events
      .filter((e) => {
        const d = new Date(e.start);
        return d >= start && d <= end;
      })
      .sort((a, b) => a.start.localeCompare(b.start));

    const out: Row[] = [];
    let currentDay = "";
    let header: Row & { kind: "header" } | null = null;
    for (const e of inRange) {
      const day = new Date(e.start).toDateString();
      if (day !== currentDay) {
        header = { kind: "header", day, count: 0 };
        out.push(header);
        currentDay = day;
      }
      out.push({ kind: "event", event: e });
      if (header) header.count += 1;
    }
    return out;
  }, [cursor, events]);

  if (rows.length === 0) {
    return (
      <div className="border border-border bg-background py-12 text-center text-muted text-[13px]" role="status">
        Nothing in this month.
      </div>
    );
  }

  if (rows.length < VIRTUALIZE_THRESHOLD) {
    return (
      <div className="border border-border bg-background" role="list" aria-label="Agenda">
        {rows.map((r, i) =>
          r.kind === "header" ? (
            <DayHeader key={`h-${i}`} day={r.day} count={r.count} />
          ) : (
            <EventRow key={r.event.id} event={r.event} onSelect={onSelect} />
          ),
        )}
      </div>
    );
  }

  return (
    <div
      className="border border-border bg-background"
      role="list"
      aria-label={`Agenda · ${rows.length} rows (virtualized)`}
    >
      <List
        rowCount={rows.length}
        rowHeight={(index) => (rows[index].kind === "header" ? HEADER_HEIGHT : ROW_HEIGHT)}
        rowComponent={VirtualRow}
        rowProps={{ rows, onSelect }}
        defaultHeight={DEFAULT_HEIGHT}
        overscanCount={6}
        style={{ height: DEFAULT_HEIGHT }}
      />
    </div>
  );
}

function VirtualRow({
  index,
  style,
  rows,
  onSelect,
}: RowComponentProps<{ rows: Row[]; onSelect: (e: CalendarEvent) => void }>) {
  const row = rows[index];
  if (row.kind === "header") {
    return (
      <div style={style}>
        <DayHeader day={row.day} count={row.count} />
      </div>
    );
  }
  return (
    <div style={style}>
      <EventRow event={row.event} onSelect={onSelect} />
    </div>
  );
}

function DayHeader({ day, count }: { day: string; count: number }) {
  return (
    <div
      className="px-4 py-2 bg-surface text-[10px] uppercase tracking-[0.18em] text-muted font-semibold flex items-center justify-between border-b border-border"
      role="heading"
      aria-level={3}
    >
      <span>{day}</span>
      <span className="tabular-nums" aria-label={`${count} events`}>{count}</span>
    </div>
  );
}

function EventRow({ event, onSelect }: { event: CalendarEvent; onSelect: (e: CalendarEvent) => void }) {
  const meta = KIND_META[event.kind];
  return (
    <button
      onClick={() => onSelect(event)}
      className="w-full text-left px-4 py-3 hover:bg-violet/[0.06] focus:bg-violet/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet transition-colors flex items-start gap-3 border-b border-border"
      aria-label={`${meta.eyebrow}: ${event.title}, ${event.allDay ? "all day" : timeFmt(event.start)}`}
      role="listitem"
    >
      <span aria-hidden className={`w-1 h-10 mt-1 shrink-0 ${meta.bg}`} />
      <div className="flex-1 min-w-0">
        <div className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${meta.tone}`}>{meta.eyebrow}</div>
        <div className="font-display font-bold text-[15px] tracking-[-0.018em] text-foreground truncate mt-0.5">
          {event.title}
        </div>
      </div>
      <div className="text-[11px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums shrink-0">
        {event.allDay ? "All day" : timeFmt(event.start)}
      </div>
    </button>
  );
}

/* ───────────── date helpers ───────────── */

function startOfMonth(d: Date): Date {
  const x = new Date(d);
  x.setDate(1);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfMonth(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  x.setHours(23, 59, 59, 999);
  return x;
}

function timeFmt(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default AgendaList;
