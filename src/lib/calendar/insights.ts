/**
 * Calendar insights — derive system events from Sync + Pulse state so
 * they land on the same grid as the user's meetings.
 *
 *   • Sync windows → recurring compile runs at user-chosen cadence
 *   • Pulse syncs  → recurring reality checks
 *   • Decay horizons → projected date each claim hits invalidation
 *   • Patch reviews → expiry deadlines for un-actioned patches
 *   • Deadline-conflicts → workspace deadlines that Sync flagged
 */

import type { Assertion, LogicalPatch, Violation } from "../sync/types";
import type { CalendarEvent } from "./types";
import { projectInvalidateAt, profileFor } from "../pulse/decay";

export interface InsightInput {
  projectId: string;
  assertions: Assertion[];
  violations?: Violation[];
  patch?: LogicalPatch | null;
  /** Cadence the user picked in Pulse — drives recurring sync events. */
  pulseCadence?: "daily" | "weekly" | "monthly" | "manual";
  /** Same idea for the Sync compile run. */
  syncCadence?: "daily" | "weekly" | "monthly" | "manual";
  /**
   * Trust threshold for projecting decay horizons (0..1). A claim's
   * horizon is the date its computed trust will dip below this value.
   * Distinct from Pulse's `invalidateThreshold` (which measures drift
   * ratio against reality, not decay over time).
   */
  decayTrustThreshold?: number;
  /** Time window we want events for. */
  rangeStart: Date;
  rangeEnd: Date;
}

const DAY = 86_400_000;

export function buildInsightEvents(input: InsightInput): CalendarEvent[] {
  const out: CalendarEvent[] = [];

  // ── Recurring system cadences ────────────────────────────────
  if (input.syncCadence && input.syncCadence !== "manual") {
    for (const d of recurringDates(input.rangeStart, input.rangeEnd, input.syncCadence)) {
      out.push({
        id: `sys_sync_${d.toISOString()}`,
        projectId: input.projectId,
        title: "Sync · workspace compile",
        start: setHour(d, 9, 0).toISOString(),
        end: setHour(d, 9, 15).toISOString(),
        allDay: false,
        kind: "sync-window",
        source: "forge",
        colorToken: "violet",
        locked: true,
        description: "Recurring compile run — re-evaluates all constraints across documents.",
      });
    }
  }
  if (input.pulseCadence && input.pulseCadence !== "manual") {
    for (const d of recurringDates(input.rangeStart, input.rangeEnd, input.pulseCadence)) {
      out.push({
        id: `sys_pulse_${d.toISOString()}`,
        projectId: input.projectId,
        title: "Pulse · reality sync",
        start: setHour(d, 8, 0).toISOString(),
        end: setHour(d, 8, 30).toISOString(),
        allDay: false,
        kind: "pulse-sync",
        source: "forge",
        colorToken: "cyan",
        locked: true,
        description: "Recurring reality-diff against the market oracle.",
      });
    }
  }

  // ── Decay horizons ────────────────────────────────────────────
  const threshold = input.decayTrustThreshold ?? 0.45;
  for (const a of input.assertions) {
    if (a.locked) continue;
    const at = projectInvalidateAt(a, threshold);
    if (!at) continue;
    const date = new Date(at);
    if (date < input.rangeStart || date > input.rangeEnd) continue;
    out.push({
      id: `sys_decay_${a.id}`,
      projectId: input.projectId,
      title: `Decay · ${a.label}`,
      start: setHour(date, 0, 0).toISOString(),
      end: setHour(date, 23, 59).toISOString(),
      allDay: true,
      kind: "decay-horizon",
      source: "forge",
      colorToken: "warm",
      locked: true,
      refs: [{ kind: "assertion", id: a.id }],
      description: `Trust crosses the ${(threshold * 100).toFixed(0)}% threshold on this date. Half-life ${profileFor(a.kind).halfLifeDays}d.`,
    });
  }

  // ── Patch reviews ────────────────────────────────────────────
  if (input.patch && input.patch.changes.length > 0) {
    // Convention: a proposed patch should be reviewed within 7 days.
    const due = new Date(input.patch.generatedAt + 7 * DAY);
    if (due >= input.rangeStart && due <= input.rangeEnd) {
      out.push({
        id: `sys_patch_${input.patch.id}`,
        projectId: input.projectId,
        title: `Review · proposed patch (${input.patch.changes.length} edits)`,
        start: setHour(due, 0, 0).toISOString(),
        end: setHour(due, 23, 59).toISOString(),
        allDay: true,
        kind: "patch-review",
        source: "forge",
        colorToken: "violet",
        locked: true,
        refs: [{ kind: "patch", id: input.patch.id }],
        description: input.patch.summary,
      });
    }
  }

  // ── Deadline conflicts ───────────────────────────────────────
  if (input.violations) {
    const deadlineAssertions = new Map<string, Assertion>();
    for (const a of input.assertions) {
      if (a.value.type === "date") deadlineAssertions.set(a.id, a);
    }
    for (const v of input.violations) {
      for (const aid of v.involved) {
        const a = deadlineAssertions.get(aid);
        if (!a || a.value.type !== "date") continue;
        const d = new Date(a.value.value);
        if (d < input.rangeStart || d > input.rangeEnd) continue;
        out.push({
          id: `sys_conflict_${v.constraintId}_${a.id}`,
          projectId: input.projectId,
          title: `Conflict · ${a.label}`,
          start: setHour(d, 0, 0).toISOString(),
          end: setHour(d, 23, 59).toISOString(),
          allDay: true,
          kind: "deadline-conflict",
          source: "forge",
          colorToken: "rose",
          locked: true,
          refs: [{ kind: "assertion", id: a.id }],
          description: v.message,
        });
      }
    }
  }

  return out;
}

function* recurringDates(start: Date, end: Date, cadence: "daily" | "weekly" | "monthly"): Generator<Date> {
  const stepDays = cadence === "daily" ? 1 : cadence === "weekly" ? 7 : 30;
  let cursor = new Date(start);
  // Snap the first occurrence to a weekday if weekly/monthly so the
  // sync doesn't land on a Saturday.
  if (cadence !== "daily" && (cursor.getDay() === 0 || cursor.getDay() === 6)) {
    const shift = cursor.getDay() === 0 ? 1 : 2;
    cursor = new Date(cursor.getTime() + shift * DAY);
  }
  while (cursor <= end) {
    yield new Date(cursor);
    cursor = new Date(cursor.getTime() + stepDays * DAY);
  }
}

function setHour(date: Date, h: number, m: number): Date {
  const d = new Date(date);
  d.setHours(h, m, 0, 0);
  return d;
}
