/**
 * Realtime fan-out for SSE — per-user in-memory pub/sub plus a Firestore
 * fallback so events still reach tabs on other server instances.
 *
 * In-memory side: zero-latency for tabs that hit the same Node process
 * (typical Vercel / Cloud Run after the first warm).
 *
 * Firestore side: every published event also lands in
 * `users/{uid}/realtime/events/{eventId}` with a 30-minute TTL. Other
 * server instances subscribe via Firestore real-time listeners and
 * relay to their own SSE subscribers. The TTL keeps the collection
 * unbounded growth at bay; Firestore TTL policies enforce it
 * automatically (configure `ttlExpiresAt` as the TTL field — see
 * setup doc).
 *
 * This module is server-only.
 */

import "server-only";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { randomToken } from "./crypto";

/* ───────────── public event shape ───────────── */

export type CalendarRealtimeEvent =
  | { kind: "sync.complete"; at: number }
  | { kind: "sync.error"; at: number; message: string }
  | { kind: "event.upsert";   at: number; eventId: string }
  | { kind: "event.delete";   at: number; eventId: string }
  | { kind: "task.upsert";    at: number; taskId: string }
  | { kind: "task.delete";    at: number; taskId: string }
  | { kind: "habit.completed"; at: number; habitId: string; streak: number }
  | { kind: "plan.replanned"; at: number; placed: number; conflicts: number }
  | { kind: "presence";        at: number; tabId: string; status: "join" | "leave" };

export interface SubscriptionContext {
  uid: string;
  tabId: string;
}

/* ───────────── in-memory channels ───────────── */

type Listener = (e: CalendarRealtimeEvent) => void;

const subscribers = new Map<string /* uid */, Set<Listener>>();
const firestoreUnsubs = new Map<string /* uid */, () => void>();

function listenersOf(uid: string): Set<Listener> {
  let set = subscribers.get(uid);
  if (!set) {
    set = new Set();
    subscribers.set(uid, set);
    attachFirestoreFallback(uid);
  }
  return set;
}

export function subscribe(ctx: SubscriptionContext, handler: Listener): () => void {
  const set = listenersOf(ctx.uid);
  set.add(handler);
  // Announce presence.
  void publishCalendarEvent(ctx.uid, { kind: "presence", at: Date.now(), tabId: ctx.tabId, status: "join" });
  return () => {
    set.delete(handler);
    void publishCalendarEvent(ctx.uid, { kind: "presence", at: Date.now(), tabId: ctx.tabId, status: "leave" });
    if (set.size === 0) {
      subscribers.delete(ctx.uid);
      const fsUnsub = firestoreUnsubs.get(ctx.uid);
      if (fsUnsub) {
        fsUnsub();
        firestoreUnsubs.delete(ctx.uid);
      }
    }
  };
}

/* ───────────── publish ───────────── */

const EVENT_TTL_MS = 30 * 60_000;

export async function publishCalendarEvent(uid: string, event: CalendarRealtimeEvent): Promise<void> {
  // 1) Fan out to in-process listeners synchronously.
  const set = subscribers.get(uid);
  if (set) {
    for (const l of set) {
      try { l(event); } catch {/* ignore */}
    }
  }
  // 2) Persist for cross-instance fan-out + late joiners.
  try {
    const fs = getAdminFirestore();
    const id = randomToken(8);
    await fs.collection(`users/${uid}/realtime/events`).doc(id).set({
      ...event,
      id,
      // TTL field — Firestore policies should expire docs at this time.
      ttlExpiresAt: new Date(Date.now() + EVENT_TTL_MS),
    });
  } catch {/* don't block the in-process publish on Firestore hiccups */}
}

/* ───────────── Firestore fallback (cross-instance) ───────────── */

const SEEN_IDS = new Map<string, Set<string>>();

function attachFirestoreFallback(uid: string): void {
  let unsub: () => void;
  try {
    const fs = getAdminFirestore();
    unsub = fs.collection(`users/${uid}/realtime/events`)
      .where("ttlExpiresAt", ">", new Date())
      .onSnapshot((snap) => {
        const seen = SEEN_IDS.get(uid) ?? new Set<string>();
        for (const change of snap.docChanges()) {
          if (change.type !== "added") continue;
          const data = change.doc.data() as CalendarRealtimeEvent & { id: string };
          if (seen.has(data.id)) continue;
          seen.add(data.id);
          const listeners = subscribers.get(uid);
          if (!listeners) continue;
          for (const l of listeners) {
            try { l(data); } catch {/* ignore */}
          }
        }
        // Bound the SEEN cache so it doesn't grow forever.
        if (seen.size > 256) {
          // Drop the oldest half.
          const arr = Array.from(seen);
          SEEN_IDS.set(uid, new Set(arr.slice(arr.length / 2)));
        } else {
          SEEN_IDS.set(uid, seen);
        }
      }, () => {/* swallow listener errors */});
  } catch {
    unsub = () => {};
  }
  firestoreUnsubs.set(uid, unsub);
}
