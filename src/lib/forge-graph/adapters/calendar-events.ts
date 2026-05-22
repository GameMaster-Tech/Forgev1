/**
 * Calendar adapter — `CalendarEvent`s become CALENDAR_EVENT nodes.
 *
 * Dependencies: events that reference an assertion or document via
 * `event.refs` get an upstream edge from the referenced node. This is
 * what lets the Tempo engine cascade a "salary cap moved" delta into a
 * "compensation review meeting" shift.
 */

import type { CalendarEvent } from "@/lib/calendar/types";
import {
  ForgeNodeCategory,
  type ForgeGraphNode,
  type NodeId,
} from "../types";
import { assertionNodeId } from "./assertions";
import { documentNodeId } from "./documents";

export function calendarEventNodeId(eventId: string): NodeId {
  return `event:${eventId}`;
}

export function calendarEventsToNodes(events: CalendarEvent[]): ForgeGraphNode[] {
  const out: ForgeGraphNode[] = new Array(events.length);
  for (let i = 0; i < events.length; i++) out[i] = calendarEventToNode(events[i]);
  return out;
}

export function calendarEventToNode(event: CalendarEvent): ForgeGraphNode {
  const start = parseIso(event.start);
  const end = parseIso(event.end);
  const durationHours =
    start && end ? Math.max(0, (end.getTime() - start.getTime()) / 3_600_000) : undefined;

  const upstream: NodeId[] = [];
  if (event.refs && event.refs.length > 0) {
    for (let i = 0; i < event.refs.length; i++) {
      const r = event.refs[i];
      if (r.kind === "assertion") upstream.push(assertionNodeId(r.id));
      else if (r.kind === "document") upstream.push(documentNodeId(r.id));
    }
  }

  return {
    id: calendarEventNodeId(event.id),
    category: ForgeNodeCategory.CALENDAR_EVENT,
    payload: {
      title: event.title,
      content: event.description ?? event.title,
      metadata: {
        startDate: start,
        endDate: end,
        durationHours,
        // The Tempo packer reads `allocatedCapacity` to detect overload —
        // events default to 100% of their window.
        allocatedCapacity: 100,
        allDay: event.allDay,
        kind: event.kind,
        source: event.source,
        location: event.location,
        externalId: event.externalId,
      },
    },
    upstreamDependencies: upstream,
    downstreamDependencies: [],
    status: "STABLE",
    version: start ? Math.floor(start.getTime() / 1000) : 1,
    origin: {
      collection: "calendar_events",
      externalId: event.id,
      projectId: event.projectId,
    },
  };
}

function parseIso(s: string | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}
