/**
 * RFC 5545 RRULE expander — subset that covers ~95% of real calendar
 * usage. Supports FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, BYDAY
 * (weekly), BYMONTHDAY (monthly), UNTIL, and COUNT.
 *
 * Returns a list of occurrence start timestamps in the [from, to]
 * window. Pure, no Date arithmetic mistakes (uses millisecond steps
 * for daily, calendar bumps for monthly/yearly).
 */

import type { RecurrenceRule, Weekday } from "./types";

const DAY = 86_400_000;
const WEEKDAYS: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEKDAY_INDEX: Record<Weekday, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

export function parseRRule(rule: string): RecurrenceRule | null {
  if (!rule.trim()) return null;
  // Accept both bare "FREQ=DAILY;..." and "RRULE:FREQ=..." forms.
  const body = rule.replace(/^RRULE:/i, "").trim();
  const parts = body.split(";").map((p) => p.split("=") as [string, string]);
  const map = new Map<string, string>(parts.filter((p) => p.length === 2).map(([k, v]) => [k.toUpperCase(), v]));

  const freq = map.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return null;

  const out: RecurrenceRule = { freq };
  const interval = map.get("INTERVAL");
  if (interval && /^\d+$/.test(interval)) out.interval = Math.max(1, parseInt(interval, 10));
  const until = map.get("UNTIL");
  if (until) {
    // UNTIL is yyyymmddThhmmssZ in spec; we accept ISO too.
    out.until = normaliseDate(until);
  }
  const count = map.get("COUNT");
  if (count && /^\d+$/.test(count)) out.count = Math.max(1, parseInt(count, 10));
  const byDay = map.get("BYDAY");
  if (byDay) {
    out.byDay = byDay.split(",").map((d) => d.toUpperCase() as Weekday).filter((d) => d in WEEKDAY_INDEX);
  }
  const byMonthDay = map.get("BYMONTHDAY");
  if (byMonthDay) {
    out.byMonthDay = byMonthDay.split(",").map((n) => parseInt(n, 10)).filter((n) => Number.isFinite(n));
  }
  return out;
}

export function formatRRule(rule: RecurrenceRule): string {
  const parts: string[] = [`FREQ=${rule.freq}`];
  if (rule.interval && rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay && rule.byDay.length) parts.push(`BYDAY=${rule.byDay.join(",")}`);
  if (rule.byMonthDay && rule.byMonthDay.length) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(",")}`);
  if (rule.until) parts.push(`UNTIL=${rule.until.replace(/[-:]/g, "").replace(/\.\d+/, "")}`);
  if (rule.count) parts.push(`COUNT=${rule.count}`);
  return parts.join(";");
}

export interface ExpandArgs {
  /** First occurrence (DTSTART). ISO. */
  dtstart: string;
  rule: RecurrenceRule | string;
  /** Window — only include occurrences whose start lies inside. */
  from: string;
  to: string;
  /** Hard cap on emitted occurrences. Default 500. */
  maxOccurrences?: number;
  /** Skip these specific ISO timestamps (RFC 5545 EXDATE). */
  exclude?: string[];
}

export function expandRecurrence(args: ExpandArgs): string[] {
  const parsed = typeof args.rule === "string" ? parseRRule(args.rule) : args.rule;
  if (!parsed) return [args.dtstart];
  const fromMs = new Date(args.from).getTime();
  const toMs   = new Date(args.to).getTime();
  const untilMs = parsed.until ? new Date(parsed.until).getTime() : Number.POSITIVE_INFINITY;
  const max = args.maxOccurrences ?? 500;
  const excluded = new Set((args.exclude ?? []).map(normaliseDate));
  const out: string[] = [];

  const dt = new Date(args.dtstart);
  const interval = parsed.interval ?? 1;

  switch (parsed.freq) {
    case "DAILY": {
      let cursor = dt.getTime();
      let count = 0;
      while (cursor <= toMs && cursor <= untilMs && (parsed.count == null || count < parsed.count) && out.length < max) {
        if (cursor >= fromMs) {
          const iso = new Date(cursor).toISOString();
          if (!excluded.has(iso)) out.push(iso);
        }
        count++;
        cursor += interval * DAY;
      }
      break;
    }
    case "WEEKLY": {
      const byDay = parsed.byDay && parsed.byDay.length > 0
        ? parsed.byDay.map((d) => WEEKDAY_INDEX[d])
        : [dt.getDay()];
      let weekStart = startOfWeek(dt.getTime());
      let occurrences = 0;
      while (weekStart <= toMs && weekStart <= untilMs && (parsed.count == null || occurrences < parsed.count) && out.length < max) {
        for (const dow of byDay) {
          const day = weekStart + dow * DAY;
          const candidate = combineDateAndTime(day, dt);
          if (candidate < dt.getTime()) continue;
          if (candidate > untilMs) break;
          if (candidate >= fromMs && candidate <= toMs) {
            const iso = new Date(candidate).toISOString();
            if (!excluded.has(iso)) out.push(iso);
          }
          occurrences++;
          if (parsed.count != null && occurrences >= parsed.count) break;
          if (out.length >= max) break;
        }
        weekStart += 7 * DAY * interval;
      }
      break;
    }
    case "MONTHLY": {
      const days = parsed.byMonthDay && parsed.byMonthDay.length > 0
        ? parsed.byMonthDay
        : [dt.getDate()];
      let cursor = new Date(dt);
      let occurrences = 0;
      while (cursor.getTime() <= toMs && cursor.getTime() <= untilMs && (parsed.count == null || occurrences < parsed.count) && out.length < max) {
        for (const d of days) {
          const candidate = new Date(cursor.getFullYear(), cursor.getMonth(), d, dt.getHours(), dt.getMinutes(), dt.getSeconds());
          if (candidate.getMonth() !== cursor.getMonth()) continue; // e.g. Feb 30
          const t = candidate.getTime();
          if (t < dt.getTime()) continue;
          if (t > untilMs) break;
          if (t >= fromMs && t <= toMs) {
            const iso = candidate.toISOString();
            if (!excluded.has(iso)) out.push(iso);
          }
          occurrences++;
          if (parsed.count != null && occurrences >= parsed.count) break;
          if (out.length >= max) break;
        }
        cursor = new Date(cursor.getFullYear(), cursor.getMonth() + interval, 1, dt.getHours(), dt.getMinutes(), dt.getSeconds());
      }
      break;
    }
    case "YEARLY": {
      let cursor = new Date(dt);
      let occurrences = 0;
      while (cursor.getTime() <= toMs && cursor.getTime() <= untilMs && (parsed.count == null || occurrences < parsed.count) && out.length < max) {
        if (cursor.getTime() >= fromMs) {
          const iso = cursor.toISOString();
          if (!excluded.has(iso)) out.push(iso);
        }
        occurrences++;
        cursor = new Date(cursor.getFullYear() + interval, cursor.getMonth(), cursor.getDate(), dt.getHours(), dt.getMinutes(), dt.getSeconds());
      }
      break;
    }
  }

  return out;
}

function startOfWeek(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d.getTime();
}

function combineDateAndTime(dayMs: number, timeOf: Date): number {
  const d = new Date(dayMs);
  d.setHours(timeOf.getHours(), timeOf.getMinutes(), timeOf.getSeconds(), timeOf.getMilliseconds());
  return d.getTime();
}

function normaliseDate(s: string): string {
  // Accept "20260901T090000Z" form and ISO.
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`;
  return s;
}

/** A friendlier name for the UI. */
export function describeRRule(rule: RecurrenceRule | string): string {
  const r = typeof rule === "string" ? parseRRule(rule) : rule;
  if (!r) return "Once";
  const every = r.interval && r.interval > 1 ? `Every ${r.interval} ` : "";
  switch (r.freq) {
    case "DAILY":   return `${every || "Every "}day${r.until ? ` until ${r.until.slice(0, 10)}` : ""}`;
    case "WEEKLY":  return `${every || "Every "}week${r.byDay?.length ? " · " + r.byDay.map(humanWeekday).join(", ") : ""}`;
    case "MONTHLY": return `${every || "Every "}month${r.byMonthDay?.length ? " · day " + r.byMonthDay.join(", ") : ""}`;
    case "YEARLY":  return `${every || "Every "}year`;
  }
}

function humanWeekday(w: Weekday): string {
  return WEEKDAYS[WEEKDAY_INDEX[w]];
}
