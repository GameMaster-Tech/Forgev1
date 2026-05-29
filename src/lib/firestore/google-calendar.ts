/**
 * External-calendar mirror — client-side Firestore bridge.
 *
 * Server-side integrations (Google Calendar + Notion) write their
 * mirrored events into the same user-scoped collection so the
 * CalendarProvider only needs one subscription:
 *
 *   /users/{uid}/google_events/{eventId}
 *
 * Each row is a `TimedEvent` tagged with `externalSource` so the
 * grid filter and disconnect cleanup can target either source. The
 * collection name is historical (it predates Notion); we keep it to
 * avoid a destructive migration.
 *
 * NOTE: this is a top-level user subcollection (3 path segments).
 * An older 4-segment design (`users/{uid}/calendar/events`) was
 * rejected by Firestore ("collection references must have an odd
 * number of segments").
 *
 * The function still ships as `subscribeGoogleEvents` for backwards-
 * compat with every caller; an alias `subscribeMirrorEvents` is
 * exported for new code that wants the wider name.
 */

import { collection, onSnapshot, type Unsubscribe } from "firebase/firestore";
import { db } from "@/lib/firebase/config";
import type { CalendarEvent } from "@/lib/calendar/types";
import type { TimedEvent } from "@/lib/scheduler/types";

/** Every source we currently mirror into `google_events`. */
const SURFACED_SOURCES = new Set(["google", "notion"]);

/**
 * Project the scheduler's heavyweight `TimedEvent` onto the
 * calendar grid's lighter `CalendarEvent`. The `source` field on
 * the output is normalised to a closed enum the grid understands
 * ("google" | "notion" | "forge"); the `colorToken` is chosen per
 * source so the user can tell at a glance where each block came
 * from.
 */
function timedToCalendarEvent(t: TimedEvent): CalendarEvent {
  const metadata = t as TimedEvent & { allDay?: boolean };
  const source =
    t.externalSource === "google"
      ? "google"
      : t.externalSource === "notion"
        ? "notion"
        : "forge";
  return {
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    description: t.description,
    start: t.start,
    end: t.end,
    allDay: metadata.allDay ?? isDateOnly(t.start),
    kind: t.eventKind ?? "meeting",
    source,
    externalId: t.externalId,
    location: t.location,
    attendees: t.attendees?.map((a) => ({ name: a.name, email: a.email })),
    colorToken: source === "notion" ? "violet" : "cyan",
  };
}

export function subscribeGoogleEvents(
  uid: string,
  onChange: (events: CalendarEvent[]) => void,
  onError?: (err: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    collection(db, "users", uid, "google_events"),
    (snap) => {
      const out: CalendarEvent[] = [];
      for (const d of snap.docs) {
        const data = d.data() as TimedEvent & { archived?: boolean; status?: string };
        if (data.archived || data.status === "cancelled") continue;
        // Surface every mirrored source — currently Google + Notion.
        // Anything else is internal scheduler bookkeeping that
        // shouldn't show on the user-facing grid.
        if (data.externalSource && SURFACED_SOURCES.has(data.externalSource)) {
          out.push(timedToCalendarEvent(data));
        }
      }
      onChange(out);
    },
    (err) => onError?.(err),
  );
}

/** Modern alias — `subscribeGoogleEvents` is kept for back-compat. */
export const subscribeMirrorEvents = subscribeGoogleEvents;

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
