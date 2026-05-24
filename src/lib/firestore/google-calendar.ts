/**
 * Google Calendar — client-side Firestore bridge.
 *
 * The server-side `/api/integrations/google/sync` route writes Google
 * events (after bidirectional diff + apply) into
 *   /users/{uid}/google_events/{eventId}
 * as `TimedEvent` rows. The Calendar grid + Tempo expect the
 * lighter-weight `CalendarEvent` shape and read from the project
 * subtree, so without a bridge those events are invisible to the UI.
 *
 * NOTE: this is a top-level user subcollection (3 path segments).
 * The older path `users/{uid}/calendar/events` was 4 segments which
 * Firestore rejects ("collection references must have an odd number
 * of segments"). The sync route writes here and we read from here.
 *
 * This module:
 *   • subscribes to the global Google-events collection via
 *     `onSnapshot`, mapped to `CalendarEvent` with `source: "google"`
 *   • is consumed by `CalendarProvider`, which merges the result
 *     into its `events` state alongside project-scoped events
 */

import { collection, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { TimedEvent } from "@/lib/scheduler/types";

/**
 * Project the scheduler's heavyweight `TimedEvent` row onto the
 * calendar grid's lighter `CalendarEvent` shape. We tag the source
 * so the grid filter ("Google calendar only") and the disconnect
 * cleanup (strip rows where source === "google") work.
 */
function timedToCalendarEvent(t: TimedEvent): CalendarEvent {
  return {
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    description: t.description,
    start: t.start,
    end: t.end,
    allDay: false,
    kind: t.eventKind ?? "meeting",
    source: t.externalSource === "google" ? "google" : "forge",
    externalId: t.externalId,
    location: t.location,
    attendees: t.attendees?.map((a) => ({ name: a.name, email: a.email })),
    colorToken: "cyan",
  };
}

export function subscribeGoogleEvents(
  uid: string,
  onChange: (events: CalendarEvent[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  // 3-segment path = valid collection. The server sync route writes here.
  return onSnapshot(
    collection(db, "users", uid, "google_events"),
    (snap) => {
      const out: CalendarEvent[] = [];
      for (const d of snap.docs) {
        const data = d.data() as TimedEvent;
        // Only surface rows that came from Google — local
        // scheduler-only entries (if any landed here historically)
        // stay invisible to the grid.
        if (data.externalSource === "google") {
          out.push(timedToCalendarEvent(data));
        }
      }
      onChange(out);
    },
    (err) => onError?.(err),
  );
}
