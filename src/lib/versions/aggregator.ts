/**
 * Aggregator — the bridge that turns Sync/Pulse/Lattice/Calendar
 * mutation events into `Version` entries.
 *
 * Two consumption modes:
 *
 *   1. **Pull** — call `seedFromActivity(activities)` to backfill the
 *      version store from the existing global activity feed.
 *
 *   2. **Push** — components call `recordVersion(args)` directly when
 *      they apply a mutation. Cheaper than re-deriving from the
 *      activity log, and works for sources the activity log doesn't
 *      cover yet.
 *
 * The aggregator never mutates source state itself — it's a fanout
 * recorder.
 */

import { getVersionStore } from "./store";
import type { Version, VersionSource } from "./types";

/* ───────────── direct-write API ───────────── */

export interface RecordArgs {
  source: VersionSource;
  title: string;
  summary: string;
  projectId?: string;
  uid?: string;
  detail?: Record<string, unknown>;
  /** Override now (tests). */
  at?: number;
  /** Whether the user can propose a restore. Defaults from source. */
  restorable?: boolean;
}

export function recordVersion(args: RecordArgs): Promise<Version> {
  return getVersionStore().push({
    source: args.source,
    title: args.title,
    summary: args.summary,
    projectId: args.projectId,
    uid: args.uid,
    detail: args.detail ?? {},
    at: args.at ?? Date.now(),
    restorable: args.restorable ?? defaultRestorable(args.source),
  });
}

function defaultRestorable(s: VersionSource): boolean {
  switch (s) {
    case "tempo.replan":
    case "lattice.subtask.decompose":
      return false;
    default:
      return true;
  }
}

/* ───────────── pull-mode: seed from activity feed ───────────── */

/**
 * Activity item shape — kept loose to avoid a hard dependency on the
 * activity-feed types (which live in @/lib/activity). The fields we
 * actually read are `kind`, `at`, `title`, `summary`, `projectId`,
 * `uid`, `detail`.
 */
interface ActivityLike {
  source?: string;
  kind: string;
  at: number;
  title: string;
  summary?: string;
  projectId?: string;
  uid?: string;
  detail?: Record<string, unknown>;
}

const KIND_TO_SOURCE: Record<string, VersionSource> = {
  "sync.patch.apply":         "sync.patch",
  "sync.patch.applied":       "sync.patch",
  "pulse.refactor.accept":    "pulse.refactor.accept",
  "pulse.refactor.reject":    "pulse.refactor.reject",
  "lattice.rebranch":         "lattice.rebranch",
  "lattice.subtask.decompose":"lattice.subtask.decompose",
  "calendar.event.upsert":    "calendar.event.upsert",
  "calendar.event.delete":    "calendar.event.delete",
  "tempo.replan":             "tempo.replan",
  "habit.completed":          "habit.completed",
  "habit.undo":               "habit.undo",
};

export function seedFromActivity(items: ActivityLike[]): Promise<Version[]> {
  const store = getVersionStore();
  const writes: Promise<Version>[] = [];
  for (const item of items) {
    const source = KIND_TO_SOURCE[item.kind];
    if (!source) continue;
    writes.push(store.push({
      source,
      at: item.at,
      title: item.title,
      summary: item.summary ?? "",
      projectId: item.projectId,
      uid: item.uid,
      detail: item.detail ?? {},
      restorable: defaultRestorable(source),
    }));
  }
  return Promise.all(writes);
}
