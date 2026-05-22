"use client";

/**
 * Shared primitives for the /calendar section.
 *
 * Hosts the cross-route KIND_META table, date helpers, the event
 * drawer + new-event modal, and the small chrome widgets (Navigator,
 * ViewSwitcher, KindLegend) that the grid uses. Underscore-prefixed
 * so it stays out of Next's routing tree.
 */

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  X,
} from "lucide-react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import type { CalendarEvent, CalendarView, EventKind } from "@/lib/calendar";

export const ease = [0.22, 0.61, 0.36, 1] as const;

/* ────────────── kind metadata ────────────── */

export const KIND_META: Record<EventKind, { label: string; tone: string; bg: string; eyebrow: string }> = {
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

/* ────────────── date helpers ────────────── */

export function startOfMonth(d: Date): Date { const x = new Date(d); x.setDate(1); x.setHours(0, 0, 0, 0); return x; }
export function endOfMonth(d: Date): Date { const x = new Date(d.getFullYear(), d.getMonth() + 1, 0); x.setHours(23, 59, 59, 999); return x; }
export function addMonths(d: Date, n: number): Date { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; }
export function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export function startOfWeek(d: Date): Date { const x = new Date(d); x.setDate(x.getDate() - x.getDay()); x.setHours(0, 0, 0, 0); return x; }
export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
export function monthLabel(d: Date): string { return d.toLocaleString("en-US", { month: "long", year: "numeric" }); }
export function eventsOnDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  return events.filter((e) => sameDay(new Date(e.start), day));
}
export function timeFmt(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
export function toLocalDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/* ────────────── chrome widgets ────────────── */

export function Navigator({
  cursor, setCursor, view,
}: {
  cursor: Date;
  setCursor: (d: Date) => void;
  view: CalendarView;
}) {
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

export function ViewSwitcher({
  view, onChange,
}: {
  view: CalendarView;
  onChange: (v: CalendarView) => void;
}) {
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

export function KindLegend() {
  const items: EventKind[] = ["meeting", "deadline", "focus", "sync-window", "pulse-sync", "decay-horizon"];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[10px] uppercase tracking-[0.12em] text-muted font-medium">
      {items.map((k) => (
        <span key={k} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={`w-1.5 h-1.5 ${KIND_META[k].bg}`} />
          {KIND_META[k].label}
        </span>
      ))}
    </div>
  );
}

/* ────────────── event drawer ────────────── */

export function EventDrawer({ event, onClose }: { event: CalendarEvent; onClose: () => void }) {
  const trapRef = useFocusTrap<HTMLDivElement>({ active: true, onClose });
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-foreground/30 z-40 flex items-end sm:items-center sm:justify-end"
      onClick={onClose}
    >
      <motion.div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-drawer-title"
        initial={{ x: 32, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 32, opacity: 0 }}
        transition={{ duration: 0.25, ease }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-md bg-background border-l border-border min-h-[60vh] sm:min-h-screen shadow-[0_30px_80px_-30px_rgba(0,0,0,0.45)]"
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span aria-hidden className={`w-1.5 h-1.5 ${KIND_META[event.kind].bg}`} />
            <span className={`text-[10px] uppercase tracking-[0.18em] font-semibold ${KIND_META[event.kind].tone}`}>
              {KIND_META[event.kind].eyebrow}
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-muted hover:text-foreground transition-colors"
            aria-label="Close event details"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <h2
            id="event-drawer-title"
            className="font-display font-bold text-[22px] tracking-[-0.022em] leading-[1.15] text-foreground"
          >
            {event.title}
          </h2>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <Clock size={12} aria-hidden />
              {new Date(event.start).toLocaleString("en-US", { weekday: "long", month: "long", day: "numeric" })}
              {!event.allDay && <> · {timeFmt(event.start)} — {timeFmt(event.end)}</>}
              {event.allDay && <> · All day</>}
            </div>
            {event.location && (
              <div className="flex items-center gap-2 text-[13px] text-muted">
                <MapPin size={12} aria-hidden /> {event.location}
              </div>
            )}
          </div>
          {event.description && (
            <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{event.description}</p>
          )}
          {event.locked && (
            <p className="text-[11px] text-muted italic">
              System event · generated by the Compiler · read-only.
            </p>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

/* ────────────── new event modal ────────────── */

export function NewEventModal({
  cursor, onClose, onCreate,
}: {
  cursor: Date;
  onClose: () => void;
  onCreate: (e: CalendarEvent) => void;
}) {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(toLocalDateInput(cursor));
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("10:00");
  const [kind, setKind] = useState<EventKind>("meeting");
  const [location, setLocation] = useState("");
  const trapRef = useFocusTrap<HTMLDivElement>({ active: true, onClose });

  function submit() {
    if (!title.trim()) return;
    const [sh, sm] = start.split(":").map(Number);
    const [eh, em] = end.split(":").map(Number);
    const startDate = new Date(date); startDate.setHours(sh, sm, 0, 0);
    const endDate = new Date(date); endDate.setHours(eh, em, 0, 0);
    onCreate({
      id: `user_${Date.now().toString(36)}`,
      projectId: null,
      title: title.trim(),
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      allDay: false,
      kind,
      source: "forge",
      location: location.trim() || undefined,
      colorToken: kind === "deadline" ? "rose" : kind === "focus" ? "violet" : "cyan",
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-foreground/30 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-event-title"
        initial={{ y: 12, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 12, opacity: 0 }}
        transition={{ duration: 0.22, ease }}
        onClick={(e) => e.stopPropagation()}
        className="bg-background border border-border w-full max-w-md shadow-[0_30px_80px_-20px_rgba(0,0,0,0.4)]"
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <span id="new-event-title" className="text-[10px] uppercase tracking-[0.18em] text-muted font-semibold">
            New event
          </span>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-muted hover:text-foreground"
            aria-label="Close new-event modal"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title"
            autoFocus
            className="w-full font-display font-bold text-[20px] tracking-[-0.02em] bg-transparent border-b border-border focus:border-violet outline-none py-1 placeholder:text-muted"
          />
          <div className="grid grid-cols-3 gap-2">
            <Field label="Date">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full border border-border bg-background px-2 py-1.5 text-[13px]"
              />
            </Field>
            <Field label="Start">
              <input
                type="time"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full border border-border bg-background px-2 py-1.5 text-[13px]"
              />
            </Field>
            <Field label="End">
              <input
                type="time"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full border border-border bg-background px-2 py-1.5 text-[13px]"
              />
            </Field>
          </div>
          <Field label="Kind">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as EventKind)}
              className="w-full border border-border bg-background px-2 py-1.5 text-[13px]"
            >
              <option value="meeting">Meeting</option>
              <option value="deadline">Deadline</option>
              <option value="focus">Focus block</option>
              <option value="personal">Personal</option>
            </select>
          </Field>
          <Field label="Location (optional)">
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Zoom, room, address…"
              className="w-full border border-border bg-background px-2 py-1.5 text-[13px]"
            />
          </Field>
        </div>
        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-foreground px-3 py-2"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!title.trim()}
            className="bg-violet text-white hover:bg-violet/90 disabled:opacity-60 text-[11px] font-semibold uppercase tracking-[0.12em] px-4 py-2 transition-colors"
          >
            Create
          </button>
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
