/**
 * Public Tempo API.
 *
 *   import { plan, scorePriority, detectConflicts, packFocusBlocks } from "@/lib/scheduler";
 */

export type {
  Energy,
  EnergyProfile,
  Goal,
  Habit,
  Task,
  TimedEvent,
  FocusBlock,
  GoalBlock,
  ScheduleItem,
  ScheduleItemKind,
  PriorityScore,
  PriorityFactor,
  Conflict,
  ConflictKind,
  OverloadPrediction,
  ProtectedWindow,
  RecurrenceRule,
  Frequency,
  Weekday,
  ShareGrant,
  ShareRole,
  UserRoutine,
  PlanRequest,
  PlanResult,
  ItemId,
  GoalId,
  HabitId,
} from "./types";
export { DEFAULT_ENERGY_PROFILE } from "./types";

export { scorePriority, scoreAll, topN, urgencyByDay, PRIORITY_WEIGHTS } from "./priority";
export type { PriorityContext } from "./priority";

export {
  detectConflicts,
  detectTimezoneMismatches,
  detectHabitCollisions,
  predictOverload,
  CONFLICT_LABELS,
  OVERLOAD_LEVEL_TONES,
} from "./conflict";

export { packFocusBlocks } from "./pack";
export type { PackInput, PackOutput } from "./pack";

export { expandRecurrence, parseRRule, formatRRule, describeRRule } from "./recurring";
export type { ExpandArgs } from "./recurring";

export {
  learnRoutine,
  inferEnergyProfile,
  inferWeeklyCapacity,
  inferMeetingLoadCaps,
  inferProtectedWindows,
} from "./routines";

export {
  decideAccess,
  grant,
  revoke,
  pruneExpired,
  createPublicLink,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
} from "./share";
export type { Operation, AccessDecision, PublicLinkShare } from "./share";

export { plan } from "./plan";

export { computeStreak, isDueNow, dueButNotCompletedToday } from "./habit-log";
export type { CompletionEntry, StreakResult } from "./habit-log";

export {
  backoffSchedule,
  bidirectionalDiff,
  resolveSyncConflict,
  timedToGoogle,
  googleToTimed,
  transition as transitionGCalState,
} from "./gcal";
export type {
  GoogleEvent,
  GoogleHttpClient,
  SyncState,
  SyncEvent,
  SyncConflict,
  ConflictPolicy,
  BidirectionalDiff,
  SyncSnapshotEntry,
} from "./gcal";

export { buildDemoSchedule, buildDemoRoutine } from "./demo";
export type { DemoBundle } from "./demo";
