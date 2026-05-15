/**
 * Google Calendar integration — stub.
 *
 * Real wiring needs a server-side OAuth flow (Google Identity Services
 * + Calendar API scope `https://www.googleapis.com/auth/calendar`). We
 * model the surface here so the rest of the app can call `connect()`,
 * `disconnect()`, and `listEvents()` against a typed shape. Swap the
 * implementations for `fetch`-based ones once the OAuth client id is
 * provisioned.
 */

import type { CalendarEvent } from "./types";

export type IntegrationStatus = "disconnected" | "connecting" | "connected" | "error";

export interface GoogleAccount {
  email: string;
  displayName: string;
  primaryCalendarId: string;
  scopes: string[];
}

export interface GoogleIntegrationState {
  status: IntegrationStatus;
  account?: GoogleAccount;
  lastSyncedAt?: string;
  errorMessage?: string;
}

const LS_KEY = "forge.calendar.google.v1";

export function readState(): GoogleIntegrationState {
  if (typeof window === "undefined") return { status: "disconnected" };
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return { status: "disconnected" };
    return JSON.parse(raw) as GoogleIntegrationState;
  } catch {
    return { status: "disconnected" };
  }
}

function writeState(state: GoogleIntegrationState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_KEY, JSON.stringify(state));
}

/**
 * Stubbed OAuth — pretends to take the user through Google's consent
 * screen and returns a fake account record. Replace with the real
 * Google Identity Services init + token exchange.
 */
export async function connect(): Promise<GoogleIntegrationState> {
  writeState({ status: "connecting" });
  await delay(800);
  const account: GoogleAccount = {
    email: "you@example.com",
    displayName: "You",
    primaryCalendarId: "primary",
    scopes: ["calendar.readonly", "calendar.events"],
  };
  const next: GoogleIntegrationState = {
    status: "connected",
    account,
    lastSyncedAt: new Date().toISOString(),
  };
  writeState(next);
  return next;
}

export async function disconnect(): Promise<GoogleIntegrationState> {
  const next: GoogleIntegrationState = { status: "disconnected" };
  writeState(next);
  return next;
}

/**
 * Pretend to fetch the next 30 days of events from the connected
 * primary calendar. Returns a deterministic-ish synthetic set so the
 * UI has something to render after a "connection".
 */
export async function listEvents(rangeStart: Date, rangeEnd: Date): Promise<CalendarEvent[]> {
  await delay(500);
  const out: CalendarEvent[] = [];
  const days = Math.max(1, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 86_400_000));
  const samples = [
    { title: "Weekly 1:1 with Maya", kind: "meeting" as const, hour: 10, durMin: 30, color: "cyan" as const },
    { title: "Customer demo · Acme", kind: "meeting" as const, hour: 14, durMin: 45, color: "warm" as const },
    { title: "Roadmap review", kind: "meeting" as const, hour: 16, durMin: 60, color: "violet" as const },
    { title: "Gym", kind: "personal" as const, hour: 7, durMin: 60, color: "green" as const },
  ];
  for (let i = 0; i < days; i++) {
    const day = new Date(rangeStart.getTime() + i * 86_400_000);
    if (day.getDay() === 0 || day.getDay() === 6) continue; // weekends off
    // Synthesise 1–2 events per weekday.
    const count = 1 + (i % 2);
    for (let j = 0; j < count; j++) {
      const sample = samples[(i + j) % samples.length];
      const start = new Date(day);
      start.setHours(sample.hour, 0, 0, 0);
      const end = new Date(start.getTime() + sample.durMin * 60_000);
      out.push({
        id: `gcal_${day.toISOString().slice(0, 10)}_${j}`,
        projectId: null,
        title: sample.title,
        start: start.toISOString(),
        end: end.toISOString(),
        allDay: false,
        kind: sample.kind,
        source: "google",
        externalId: `evt_${i}_${j}`,
        colorToken: sample.color,
      });
    }
  }
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
