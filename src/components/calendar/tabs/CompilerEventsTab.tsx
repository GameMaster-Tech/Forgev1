"use client";

/**
 * CompilerEventsTab — chronological list of Sync / Pulse / Decay events.
 *
 * The catalogue can grow large on long-running projects (Pulse fires
 * weekly, Decay horizons accumulate). When the upcoming queue exceeds
 * VIRTUALIZE_THRESHOLD we hand off to react-window so the DOM stays
 * lean.
 */

import { useMemo } from "react";
import { List, type RowComponentProps } from "react-window";
import type { CalendarEvent, EventKind } from "@/lib/calendar";

const VIRTUALIZE_THRESHOLD = 100;
const ROW_HEIGHT = 80;
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

interface CompilerEventsTabProps {
  events: CalendarEvent[];
  onSelect: (e: CalendarEvent) => void;
}

export function CompilerEventsTab({ events, onSelect }: CompilerEventsTabProps) {
  const upcoming = useMemo(() => {
    const now = new Date();
    return events
      .filter((e) => new Date(e.start) >= now)
      .sort((a, b) => a.start.localeCompare(b.start));
  }, [events]);

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div>
        <h2 className="font-display font-bold text-[22px] tracking-[-0.02em] text-foreground mb-2">
          Compiler events.
        </h2>
        <p className="text-[13px] text-muted leading-relaxed">
          Sync windows, Pulse reality-sync runs, decay horizons, patch reviews, and deadline conflicts — every event Forge generates, in order.
        </p>
      </div>
      {upcoming.length === 0 ? (
        <div className="border border-border bg-surface py-12 text-center text-muted text-[13px]" role="status">
          Nothing scheduled. The compiler is quiet.
        </div>
      ) : upcoming.length < VIRTUALIZE_THRESHOLD ? (
        <ul className="border border-border bg-surface divide-y divide-border" aria-label="Compiler events">
          {upcoming.map((e) => (
            <li key={e.id}>
              <CompilerRow event={e} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      ) : (
        <div
          className="border border-border bg-surface"
          role="list"
          aria-label={`Compiler events · ${upcoming.length} rows (virtualized)`}
        >
          <List
            rowCount={upcoming.length}
            rowHeight={ROW_HEIGHT}
            rowComponent={VirtualRow}
            rowProps={{ events: upcoming, onSelect }}
            defaultHeight={DEFAULT_HEIGHT}
            overscanCount={6}
            style={{ height: DEFAULT_HEIGHT }}
          />
        </div>
      )}
    </div>
  );
}

function VirtualRow({
  index,
  style,
  events,
  onSelect,
}: RowComponentProps<{ events: CalendarEvent[]; onSelect: (e: CalendarEvent) => void }>) {
  return (
    <div style={style}>
      <CompilerRow event={events[index]} onSelect={onSelect} />
    </div>
  );
}

function CompilerRow({ event, onSelect }: { event: CalendarEvent; onSelect: (e: CalendarEvent) => void }) {
  const meta = KIND_META[event.kind];
  return (
    <button
      onClick={() => onSelect(event)}
      className="w-full text-left px-5 py-4 hover:bg-violet/[0.05] focus:bg-violet/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet transition-colors flex items-start gap-3 border-b border-border last:border-b-0"
      aria-label={`${meta.eyebrow}: ${event.title}`}
    >
      <span aria-hidden className={`w-1 h-12 mt-0.5 shrink-0 ${meta.bg}`} />
      <div className="flex-1 min-w-0">
        <div className={`text-[10px] uppercase tracking-[0.15em] font-semibold ${meta.tone}`}>{meta.eyebrow}</div>
        <div className="text-[15px] font-medium text-foreground truncate mt-0.5">{event.title}</div>
        <div className="text-[11px] uppercase tracking-[0.12em] text-muted font-medium tabular-nums mt-0.5">
          {new Date(event.start).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          {!event.allDay && ` · ${new Date(event.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
        </div>
      </div>
    </button>
  );
}

export default CompilerEventsTab;
