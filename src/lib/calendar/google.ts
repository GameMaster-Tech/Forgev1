/**
 * Google Calendar integration — client helper.
 *
 * Backed by the real server routes:
 *
 *   GET  /api/integrations/google/start       — kicks off OAuth (redirect)
 *   GET  /api/integrations/google/callback    — Google → here, token exchange
 *   GET  /api/integrations/google/status      — current state for the UI
 *   POST /api/integrations/google/sync        — pull + push event diff
 *   POST /api/integrations/google/disconnect  — revoke + cleanup
 *   POST /api/integrations/google/watch       — push channel registration
 *   POST /api/integrations/google/webhook     — push receiver (Google → here)
 *
 * Connect flow:
 *   1. `connect()` → window.location to /start; Google redirects to /callback
 *   2. /callback writes the integration doc and bounces back to /calendar
 *   3. Provider re-mounts → `readState()` returns the live status
 *
 * Disconnect: POST /disconnect, then `readState()` again.
 * Events: POST /sync (server pulls fresh from Google, returns events).
 */

import { auth } from "@/lib/firebase/config";
import type { CalendarEvent } from "./types";

export type IntegrationStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

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
  /**
   * `true` when the server has the GOOGLE_OAUTH_* env vars set. UIs
   * render a clear "not configured" message instead of letting the
   * user click a button that 500s.
   */
  configured?: boolean;
}

const STATUS_URL = "/api/integrations/google/status";
const START_URL = "/api/integrations/google/start";
const DISCONNECT_URL = "/api/integrations/google/disconnect";
const SYNC_URL = "/api/integrations/google/sync";

async function authHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  try {
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

/**
 * Same as authHeaders but **forces** a fresh ID token. Required for
 * the session-cookie mint at `/api/auth/session`, which rejects any
 * ID token whose `auth_time` is older than 5 minutes (a Firebase
 * security requirement on `createSessionCookie`).
 */
async function freshAuthHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  try {
    const token = await user.getIdToken(true);
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

/**
 * Synchronous read of the *cached* state. The first call returns
 * "disconnected" because the real status is fetched async — call
 * `refreshState()` to populate the cache.
 */
let stateCache: GoogleIntegrationState = { status: "disconnected" };

export function readState(): GoogleIntegrationState {
  return stateCache;
}

export async function refreshState(): Promise<GoogleIntegrationState> {
  try {
    const headers = await authHeaders();
    const res = await fetch(STATUS_URL, { headers, cache: "no-store" });
    if (!res.ok) {
      stateCache = { status: "disconnected" };
      return stateCache;
    }
    stateCache = (await res.json()) as GoogleIntegrationState;
    return stateCache;
  } catch {
    stateCache = { status: "disconnected" };
    return stateCache;
  }
}

/**
 * Start the OAuth flow.
 *
 * Browsers can't send a Bearer header on a top-level navigation, so
 * before redirecting to the Google consent screen we mint an HttpOnly
 * `__session` cookie via `/api/auth/session`. The server's
 * `verifyRequest` accepts that cookie, so once it's set the navigation
 * works without any custom headers.
 *
 * The `returnTo` parameter brings the user back to the page they were
 * on so the connection feels in-line, not a full nav reset.
 */
export async function connect(): Promise<GoogleIntegrationState> {
  stateCache = { status: "connecting" };
  if (typeof window === "undefined") return stateCache;

  const returnTo = window.location.pathname + (window.location.search ?? "");
  const url = `${START_URL}?returnTo=${encodeURIComponent(returnTo)}`;

  try {
    // Firebase's createSessionCookie rejects ID tokens older than 5
    // minutes, so force-refresh before minting the cookie. Without
    // this, the second Google connect on a long-running session
    // silently 401s with "Re-authenticate to issue a session."
    const headers = await freshAuthHeaders();
    if (!headers.Authorization) {
      stateCache = {
        status: "error",
        errorMessage: "Please sign in again to connect Google.",
      };
      return stateCache;
    }
    // Mint the session cookie. The server sets it as HttpOnly + SameSite=lax
    // so the upcoming navigation to /api/integrations/google/start
    // carries it automatically.
    const session = await fetch("/api/auth/session", {
      method: "POST",
      headers,
      credentials: "same-origin",
    });
    if (!session.ok) {
      let detail = "Couldn't open a Google session — sign in again.";
      try {
        const body = (await session.json()) as { error?: string };
        if (body.error) detail = body.error;
      } catch {
        /* keep the default */
      }
      stateCache = { status: "error", errorMessage: detail };
      return stateCache;
    }
    // Top-level nav. The browser sends the __session cookie; the
    // start endpoint reads it via verifyRequest and redirects to Google.
    window.location.href = url;
    return stateCache;
  } catch (err) {
    stateCache = {
      status: "error",
      errorMessage:
        err instanceof Error ? err.message : "Couldn't start Google sign-in.",
    };
    return stateCache;
  }
}

export async function disconnect(): Promise<GoogleIntegrationState> {
  try {
    const headers = await authHeaders();
    await fetch(DISCONNECT_URL, { method: "POST", headers });
  } catch {
    /* server already idempotent; ignore */
  }
  stateCache = { status: "disconnected" };
  return stateCache;
}

/**
 * Trigger a sync run. The server route writes events to
 * `users/{uid}/google_events` via the Admin SDK; the
 * `CalendarProvider` subscribes to that three-segment collection
 * through `subscribeGoogleEvents`, so events appear in the grid via
 * the live subscription. Returns `[]` for legacy call-site
 * compatibility.
 */
export async function listEvents(
  rangeStart: Date,
  rangeEnd: Date,
): Promise<CalendarEvent[]> {
  try {
    const headers = await authHeaders();
    const res = await fetch(SYNC_URL, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        rangeStart: rangeStart.toISOString(),
        rangeEnd: rangeEnd.toISOString(),
      }),
    });
    if (!res.ok) {
      if (res.status === 401) {
        stateCache = { status: "error", errorMessage: "Please sign in again." };
      } else if (res.status === 410) {
        // Refresh token revoked upstream — user must reconnect.
        stateCache = {
          status: "error",
          errorMessage: "Google access expired. Reconnect to keep syncing.",
        };
      }
      return [];
    }
    stateCache = {
      ...stateCache,
      status: "connected",
      lastSyncedAt: new Date().toISOString(),
    };
    return [];
  } catch {
    return [];
  }
}
