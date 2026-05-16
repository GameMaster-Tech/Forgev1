/**
 * Activity feed — every system event Forge emits, in reverse-chrono
 * order. A unified surface across Sync, Pulse, Lattice, calendar,
 * habits, sharing, and Tempo replans.
 *
 * Storage model:
 *   • Each event is mirrored to `users/{uid}/activity/{eventId}`.
 *   • Source feeds (Sync compiles, Pulse syncs, calendar upserts, …)
 *     write through this module instead of directly to Firestore so
 *     fan-out happens in one place and the schema stays consistent.
 *
 * Client API:
 *   • `recordActivity(event)`   — local write + Firestore mirror
 *   • `subscribeActivity(...)`  — onSnapshot listener with filter args
 *   • `clearLocalActivity()`    — reset the in-memory log (dev/QA)
 *
 * Pure-data shape: `ActivityEvent`. Source-specific payloads live in
 * `detail` as a JSON-safe record.
 */

import {
  collection,
  doc,
  setDoc,
  serverTimestamp,
  query,
  where,
  orderBy,
  limit as fsLimit,
  onSnapshot,
  type DocumentData,
  type QueryConstraint,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "../firebase/config";

export type ActivitySource =
  | "sync"
  | "pulse"
  | "lattice"
  | "calendar"
  | "habit"
  | "share"
  | "tempo";

export type ActivityKind =
  | "sync.compile"
  | "sync.patch.apply"
  | "sync.patch.undo"
  | "pulse.run"
  | "pulse.refactor.accept"
  | "pulse.refactor.reject"
  | "lattice.rebranch"
  | "lattice.task.upsert"
  | "lattice.task.delete"
  | "calendar.event.upsert"
  | "calendar.event.delete"
  | "habit.completed"
  | "habit.skipped"
  | "share.granted"
  | "share.revoked"
  | "tempo.replan";

export interface ActivityEvent {
  /** Stable id — `${source}_${timestamp}_${randomNonce}`. */
  id: string;
  source: ActivitySource;
  kind: ActivityKind;
  /** ms-since-epoch timestamp the event was emitted at. */
  at: number;
  /** Optional project id the event belongs to. */
  projectId?: string;
  /** Optional user-friendly title shown in the feed row. */
  title: string;
  /** One-line summary (rendered as body of the feed row). */
  summary: string;
  /** Source-specific extra fields. */
  detail?: Record<string, unknown>;
}

/* ───────────── client store (in-memory log) ───────────── */

interface Listener {
  (events: ActivityEvent[]): void;
}

let LOCAL_LOG: ActivityEvent[] = [];
const LISTENERS = new Set<Listener>();

function emit() {
  for (const fn of LISTENERS) {
    try {
      fn([...LOCAL_LOG]);
    } catch (err) {
      console.warn("[activity] listener threw:", err);
    }
  }
}

/** Subscribe to the local log. Returns an unsubscribe. */
export function subscribeLocal(fn: Listener): () => void {
  LISTENERS.add(fn);
  fn([...LOCAL_LOG]);
  return () => { LISTENERS.delete(fn); };
}

/** Force-reset the local log. Test/QA only. */
export function clearLocalActivity(): void {
  LOCAL_LOG = [];
  emit();
}

/**
 * Push an activity event into the local log + (if a uid is supplied)
 * mirror it to Firestore. Returns the event with its assigned id.
 *
 * Source pages may call this without awaiting — persistence is
 * best-effort.
 */
export function recordActivity(
  input: Omit<ActivityEvent, "id" | "at"> & { at?: number; uid?: string },
): ActivityEvent {
  const event: ActivityEvent = {
    id: makeEventId(input.source, input.at ?? Date.now()),
    at: input.at ?? Date.now(),
    source: input.source,
    kind: input.kind,
    projectId: input.projectId,
    title: input.title,
    summary: input.summary,
    detail: input.detail,
  };
  LOCAL_LOG = [event, ...LOCAL_LOG].slice(0, 1000); // bound the in-memory log
  emit();
  if (input.uid) {
    void mirrorActivity(input.uid, event).catch((err) => {
      console.warn("[activity] mirror failed (non-fatal):", err);
    });
  }
  return event;
}

function makeEventId(source: ActivitySource, at: number): string {
  return `${source}_${at}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ───────────── Firestore mirror ───────────── */

async function mirrorActivity(uid: string, event: ActivityEvent): Promise<void> {
  const ref = doc(db, "users", uid, "activity", event.id);
  await setDoc(ref, {
    ...event,
    syncedAt: serverTimestamp(),
  });
}

/* ───────────── subscriptions ───────────── */

export interface SubscribeActivityOptions {
  uid: string;
  /** Optional source filter — only events from these sources are returned. */
  sources?: ActivitySource[];
  /** Optional project filter. */
  projectId?: string;
  /** Latest N events (default 200). */
  limit?: number;
  onEvents: (events: ActivityEvent[]) => void;
  onError?: (err: Error) => void;
}

/**
 * Stream the persisted activity log from Firestore for the given user.
 * Filters are applied client-side where Firestore can't index across
 * multiple `where()` calls without composite indexes; the limit clause
 * ensures the read stays bounded.
 */
export function subscribeActivity(opts: SubscribeActivityOptions): Unsubscribe {
  const { uid, projectId, sources, limit, onEvents, onError } = opts;
  const colRef = collection(db, "users", uid, "activity");
  const constraints: QueryConstraint[] = [];
  if (projectId) constraints.push(where("projectId", "==", projectId));
  constraints.push(orderBy("at", "desc"));
  constraints.push(fsLimit(limit ?? 200));
  const q = query(colRef, ...constraints);
  return onSnapshot(
    q,
    (snap) => {
      const out: ActivityEvent[] = [];
      for (const docSnap of snap.docs) {
        const raw = docSnap.data() as DocumentData;
        const evt: ActivityEvent = {
          id: docSnap.id,
          source: (raw.source ?? "sync") as ActivitySource,
          kind: (raw.kind ?? "sync.compile") as ActivityKind,
          at: typeof raw.at === "number" ? raw.at : Date.now(),
          projectId: raw.projectId,
          title: raw.title ?? "",
          summary: raw.summary ?? "",
          detail: (raw.detail ?? undefined) as Record<string, unknown> | undefined,
        };
        if (sources && !sources.includes(evt.source)) continue;
        out.push(evt);
      }
      onEvents(out);
    },
    (err) => onError?.(err as Error),
  );
}

/* ───────────── filters / formatting ───────────── */

export interface ActivityFilterArgs {
  sources?: Set<ActivitySource>;
  projectId?: string;
  /** Lower bound (inclusive). */
  since?: number;
  /** Upper bound (exclusive). */
  until?: number;
}

export function filterEvents(events: ActivityEvent[], f: ActivityFilterArgs): ActivityEvent[] {
  return events.filter((e) => {
    if (f.sources && !f.sources.has(e.source)) return false;
    if (f.projectId && e.projectId !== f.projectId) return false;
    if (f.since != null && e.at < f.since) return false;
    if (f.until != null && e.at >= f.until) return false;
    return true;
  });
}

/** Human-readable timestamp formatter. */
export function formatActivityTime(t: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - t);
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 60 * 60_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 24 * 60 * 60_000) return `${Math.round(diff / (60 * 60_000))}h ago`;
  return new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

/* ───────────── source convenience helpers ───────────── */

export function recordSyncCompile(args: { uid?: string; projectId?: string; assertions: number; violations: number }) {
  return recordActivity({
    source: "sync",
    kind: "sync.compile",
    title: "Sync · workspace compiled",
    summary: `${args.assertions} assertions checked · ${args.violations} violation${args.violations === 1 ? "" : "s"}`,
    projectId: args.projectId,
    uid: args.uid,
    detail: { assertions: args.assertions, violations: args.violations },
  });
}

export function recordPulseRun(args: { uid?: string; projectId?: string; invalidated: number; stale: number; fresh: number }) {
  return recordActivity({
    source: "pulse",
    kind: "pulse.run",
    title: "Pulse · reality-sync run",
    summary: `${args.invalidated} invalidated · ${args.stale} stale · ${args.fresh} fresh`,
    projectId: args.projectId,
    uid: args.uid,
    detail: { ...args },
  });
}

export function recordLatticeRebranch(args: { uid?: string; projectId?: string; added: number; removed: number; statusChanged: number }) {
  return recordActivity({
    source: "lattice",
    kind: "lattice.rebranch",
    title: "Lattice · rebranched",
    summary: `+${args.added} added · -${args.removed} removed · ${args.statusChanged} status`,
    projectId: args.projectId,
    uid: args.uid,
    detail: { ...args },
  });
}
