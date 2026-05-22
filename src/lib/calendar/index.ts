/**
 * Public Calendar API.
 */

export type {
  CalendarEvent,
  CalendarFilter,
  CalendarView,
  EventKind,
  EventSource,
} from "./types";

export {
  connect as connectGoogleCalendar,
  disconnect as disconnectGoogleCalendar,
  listEvents as listGoogleEvents,
  readState as readGoogleState,
  refreshState as refreshGoogleState,
  type GoogleAccount,
  type GoogleIntegrationState,
  type IntegrationStatus,
} from "./google";

export { buildInsightEvents } from "./insights";
export type { InsightInput } from "./insights";
