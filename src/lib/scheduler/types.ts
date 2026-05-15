/**
 * Tempo — Forge's AI-native scheduling layer.
 *
 * Type contract. Tempo unifies four primitives every existing calendar
 * tool keeps separate:
 *
 *   • Event   — a fixed-time commitment (meeting, call, deadline).
 *   • Task    — work that needs N minutes done by some deadline,
 *               schedulable any time it fits.
 *   • Habit   — recurring intention with streak + decay.
 *   • Goal    — long-running outcome that exerts "gravity" on focus
 *               blocks until satisfied.
 *
 * The scheduler treats them all as `ScheduleItem`s with a common
 * priority + energy + duration interface, then packs them onto a
 * timeline that respects the user's energy profile, meeting load caps,
 * and protected blocks (sleep, gym, family). Headless. Pure.
 *
 * Distinctions from Motion / Sunsama / Cron / Notion Calendar:
 *
 *   • Tempo is **explainable**. Every auto-placed block carries a
 *     `placementRationale` chain — no black box.
 *   • Tempo is **decay-aware**. Tasks bound to Pulse-tracked
 *     assertions inherit urgency from their data's half-life.
 *   • Tempo treats **goals as schedulable gravity**, not metadata.
 *   • Tempo integrates with **Sync constraints** — a deadline that
 *     contradicts a budget surfaces as a scheduling conflict.
 */

import type { TaskId } from "../lattice/types";
import type { EventKind } from "../calendar/types";

/* ───────────── ids ───────────── */

export type ItemId = string;
export type GoalId = string;
export type HabitId = string;
export type FocusBlockId = string;
export type RoutineId = string;

/* ───────────── energy & focus ───────────── */

/**
 * Cognitive energy levels. Tempo schedules deep work into "deep"
 * windows, light admin into "shallow" windows. Inferred from
 * historical activity if `UserRoutine` is supplied.
 */
export type Energy = "deep" | "shallow" | "creative" | "social" | "rest";

/**
 * 24-hour energy profile. Index = hour of day (0-23), value = primary
 * energy expected at that hour for this user. The routine learner
 * populates this from history.
 */
export type EnergyProfile = Energy[];

export const DEFAULT_ENERGY_PROFILE: EnergyProfile = [
  // 0-5 rest
  "rest", "rest", "rest", "rest", "rest", "rest",
  // 6-8 shallow ramp
  "shallow", "shallow", "shallow",
  // 9-12 deep morning
  "deep", "deep", "deep", "deep",
  // 13-14 social/shallow
  "shallow", "social",
  // 15-17 deep afternoon
  "deep", "deep", "deep",
  // 18-21 social/creative
  "social", "creative", "creative", "creative",
  // 22-23 rest
  "rest", "rest",
];

/* ───────────── priority ───────────── */

export interface PriorityScore {
  /** 0..100, where 100 is "burning down the door". */
  score: number;
  /** Contributing factor breakdown — explainable scheduling. */
  factors: PriorityFactor[];
}

export interface PriorityFactor {
  kind:
    | "deadline-proximity"
    | "dependency-depth"
    | "decay-urgency"
    | "goal-gravity"
    | "habit-streak"
    | "user-pin"
    | "manual-floor"
    | "meeting-load";
  /** Points contributed to the total score. May be negative. */
  contribution: number;
  /** Plain-English explanation. */
  reason: string;
}

/* ───────────── core item shapes ───────────── */

export type ScheduleItemKind = "event" | "task" | "habit" | "goal-block" | "focus-block";

export interface ScheduleItemBase {
  id: ItemId;
  projectId: string | null;
  ownerId: string;
  title: string;
  description?: string;
  kind: ScheduleItemKind;
  /** Inclusive ISO timestamps. For tasks, set when scheduled. */
  start: string | null;
  end: string | null;
  /** Energy this item needs. Used by the packer. */
  energy: Energy;
  /** Estimated minutes. Used for unscheduled tasks and goal-blocks. */
  durationMinutes: number;
  /** ISO time zone the user lives in for this item. */
  timeZone: string;
  /** Tempo's last-computed priority. Recomputed on every replan. */
  priority: PriorityScore;
  /** When set, this item must NEVER be auto-moved. */
  pinned: boolean;
  /** When set, item was placed by the auto-scheduler. */
  autoPlaced: boolean;
  placementRationale?: string[];
  /** Bound assertion keys — drives decay-aware urgency. */
  boundAssertionKeys?: string[];
  /** Bound Lattice task — completes when the task does. */
  boundTaskId?: TaskId;
  /** Bound goal — counts toward goal progress when complete. */
  boundGoalId?: GoalId;
  createdAt: number;
  updatedAt: number;
}

export interface TimedEvent extends ScheduleItemBase {
  kind: "event";
  eventKind: EventKind;
  start: string;
  end: string;
  location?: string;
  attendees?: { name: string; email?: string; rsvp?: "accepted" | "declined" | "tentative" | "needs-action" }[];
  externalId?: string;
  externalSource?: "google" | "outlook" | "ical";
  /** Last-modified timestamp from the source. Used for sync diffing. */
  externalEtag?: string;
}

export interface Task extends ScheduleItemBase {
  kind: "task";
  /** Hard deadline if any. */
  due?: string;
  /** Whether the task can be split across multiple sittings. */
  splittable: boolean;
  /** Minimum block in minutes when split. */
  minBlockMinutes?: number;
  /** Progress 0..1. */
  progress: number;
  status: "open" | "in_progress" | "done" | "abandoned";
}

export interface Habit {
  id: HabitId;
  projectId: string | null;
  ownerId: string;
  title: string;
  /** RFC 5545-subset rule string ("FREQ=DAILY", "FREQ=WEEKLY;BYDAY=MO,WE,FR"). */
  rrule: string;
  durationMinutes: number;
  energy: Energy;
  timeZone: string;
  /** Streak length in days. */
  streak: number;
  /** When the user last completed this habit, ISO. */
  lastCompletedAt?: string;
  /** When the habit was first created. */
  createdAt: number;
  /** Soft-delete instead of hard-delete so history stays intact. */
  archivedAt?: number;
}

export interface Goal {
  id: GoalId;
  projectId: string | null;
  ownerId: string;
  title: string;
  description?: string;
  /** Target outcome the goal is "satisfied" by — free-text for v1. */
  successCriteria?: string;
  /** Optional hard deadline. */
  targetDate?: string;
  /**
   * Minutes per week Tempo should pull toward this goal. Drives the
   * goal-gravity factor of the priority engine.
   */
  weeklyMinutesTarget: number;
  /** Cumulative minutes attributed to this goal. */
  loggedMinutes: number;
  status: "active" | "paused" | "achieved" | "abandoned";
  createdAt: number;
}

/* ───────────── focus blocks ───────────── */

export interface FocusBlock extends ScheduleItemBase {
  kind: "focus-block";
  start: string;
  end: string;
  /** Tasks/goal-blocks scheduled inside this block, in declared order. */
  contents: ItemId[];
}

export interface GoalBlock extends ScheduleItemBase {
  kind: "goal-block";
  start: string;
  end: string;
  goalId: GoalId;
}

export type ScheduleItem = TimedEvent | Task | FocusBlock | GoalBlock;

/* ───────────── conflicts & overload ───────────── */

export type ConflictKind =
  | "time-overlap"             // two timed items share a slot
  | "deadline-impossible"      // remaining work > free time before due
  | "energy-mismatch"          // deep work scheduled in a shallow window
  | "overload"                 // total committed minutes exceed budget
  | "double-booking"           // same attendee in two places at once
  | "sync-constraint"          // Sync says this deadline contradicts a budget
  | "tz-mismatch"              // attendees disagree across time zones
  | "habit-collision";         // scheduled item displaces a habit

export interface Conflict {
  id: string;
  kind: ConflictKind;
  /** Items implicated, blame-share first. */
  itemIds: ItemId[];
  /** Plain-English explanation. */
  message: string;
  /** 0..1 — how confident Tempo is this is actually a problem. */
  severity: "low" | "medium" | "high";
  /** Optional suggestion for the user (move X to Y, shorten Z, etc.). */
  suggestion?: string;
  detectedAt: number;
}

export interface OverloadPrediction {
  date: string;             // YYYY-MM-DD
  committedMinutes: number;
  capacityMinutes: number;
  /** committed / capacity. > 1 = predicted overload. */
  load: number;
  /** Heatmap level 0-4 for the calendar render. */
  level: 0 | 1 | 2 | 3 | 4;
  reasons: string[];
}

/* ───────────── recurring rules (RFC 5545 subset) ───────────── */

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export interface RecurrenceRule {
  freq: Frequency;
  /** Every N units of `freq`. Default 1. */
  interval?: number;
  /** Weekdays the event recurs on (WEEKLY only). */
  byDay?: Weekday[];
  /** Specific day-of-month (MONTHLY only). */
  byMonthDay?: number[];
  /** Stop after this ISO timestamp. */
  until?: string;
  /** Stop after this many occurrences. Mutually exclusive with `until`. */
  count?: number;
}

/* ───────────── routines & learning ───────────── */

export interface UserRoutine {
  id: RoutineId;
  ownerId: string;
  /**
   * Heuristically inferred from past calendar activity. The learner
   * scans the last 90 days, clusters meetings + completed tasks by
   * (hour-of-day, weekday), and emits a typical-day-shape.
   */
  energyProfile: EnergyProfile;
  /** Minutes of capacity per weekday, 0=Sunday. */
  weeklyCapacityMinutes: number[];
  /** Hard caps: max meeting minutes per weekday. */
  meetingLoadCapsMinutes: number[];
  /** Always-off windows (sleep, gym, family). */
  protectedWindows: ProtectedWindow[];
  /** ISO time zone the user lives in. */
  timeZone: string;
  /** Last time we re-learned this profile. */
  lastLearnedAt: number;
}

export interface ProtectedWindow {
  /** 0 = Sunday. */
  weekday: number;
  /** "HH:MM" 24-hour local time. */
  start: string;
  end: string;
  reason: string;
}

/* ───────────── permissions & sharing ───────────── */

export type ShareRole = "owner" | "editor" | "commenter" | "viewer" | "free-busy";

export interface ShareGrant {
  id: string;
  /** What's shared. */
  resource: { kind: "calendar" | "event" | "task" | "goal"; id: string };
  /** Granted to. */
  principal: { kind: "user" | "team" | "link"; id: string; displayName?: string };
  role: ShareRole;
  /** Optional expiry. */
  expiresAt?: string;
  /** Audit trail. */
  grantedBy: string;
  grantedAt: number;
}

/* ───────────── plan + replan ───────────── */

export interface PlanRequest {
  /**
   * Range to plan over. The scheduler will only mutate items inside
   * this window, never outside.
   */
  rangeStart: string;
  rangeEnd: string;
  /** Items in the workspace. */
  events: TimedEvent[];
  tasks: Task[];
  habits: Habit[];
  goals: Goal[];
  /** User's routine. Falls back to `DEFAULT_ENERGY_PROFILE` if absent. */
  routine?: UserRoutine;
  /** Optional pin: respect these items exactly as-is. */
  pinnedIds?: ItemId[];
  /** "now" for deterministic tests. */
  now?: number;
}

export interface PlanResult {
  /** All items in their final scheduled state. */
  items: ScheduleItem[];
  /** Newly created focus / goal blocks. */
  newBlocks: (FocusBlock | GoalBlock)[];
  /** Items that could not be placed (over-capacity / impossible). */
  unscheduled: { item: Task | Habit; reason: string }[];
  conflicts: Conflict[];
  overload: OverloadPrediction[];
  /** Wall-clock at planning time. */
  plannedAt: number;
  /** Free-form text the UI can show as "what the scheduler did". */
  summary: string;
}
