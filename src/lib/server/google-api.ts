/**
 * Server-side Google APIs client.
 *
 * Thin `fetch` wrapper that implements the `GoogleHttpClient` interface
 * the scheduler defines, plus the calendar push (watch) API. Handles:
 *
 *   • access-token refresh on `expiresAt` rollover
 *   • exponential backoff on 429 / 5xx (uses scheduler.backoffSchedule)
 *   • token revocation detection (invalid_grant → marks integration revoked)
 *   • paginated event listing
 *
 * Errors are typed (`GoogleApiError`) so callers can branch on
 * `revoked | rateLimited | transient | fatal`.
 */

import "server-only";
import {
  backoffSchedule,
  type GoogleEvent,
  type GoogleHttpClient,
} from "@/lib/scheduler";
import { encrypt, decrypt, type EncryptedBlob } from "./crypto";
import { getAdminFirestore } from "../firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

/* ───────────── types ───────────── */

export type GoogleApiErrorKind = "revoked" | "rate-limited" | "transient" | "fatal" | "unauthenticated";

export class GoogleApiError extends Error {
  constructor(public kind: GoogleApiErrorKind, message: string, public status?: number) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export interface IntegrationDoc {
  status: "connected" | "disconnected" | "revoked";
  account?: { email: string; displayName: string };
  refreshTokenEncrypted?: EncryptedBlob;
  accessToken?: string;             // ephemeral, rotated frequently
  accessTokenExpiresAt?: number;
  scopes?: string[];
  connectedAt?: number;
  lastSyncedAt?: number;
  lastError?: { code: string; at: number; message: string };
  pushChannel?: {
    id: string;
    resourceId: string;
    expirationMs: number;
    tokenEncrypted?: EncryptedBlob;
  };
}

/* ───────────── token lifecycle ───────────── */

const SAFETY_WINDOW_MS = 5 * 60_000;

export async function ensureFreshAccessToken(uid: string): Promise<string> {
  const fs = getAdminFirestore();
  const ref = fs.doc(`users/${uid}/integrations/google`);
  const snap = await ref.get();
  if (!snap.exists) throw new GoogleApiError("unauthenticated", "no google integration");
  const doc = snap.data() as IntegrationDoc;
  if (doc.status !== "connected") throw new GoogleApiError("unauthenticated", `integration is ${doc.status}`);
  if (doc.accessToken && doc.accessTokenExpiresAt && doc.accessTokenExpiresAt - Date.now() > SAFETY_WINDOW_MS) {
    return doc.accessToken;
  }
  if (!doc.refreshTokenEncrypted) throw new GoogleApiError("unauthenticated", "no refresh token on file");
  const refreshToken = decrypt(doc.refreshTokenEncrypted);
  const body = new URLSearchParams({
    client_id: required("GOOGLE_OAUTH_CLIENT_ID"),
    client_secret: required("GOOGLE_OAUTH_CLIENT_SECRET"),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    let payload: { error?: string; error_description?: string } = {};
    try { payload = await res.json() as { error?: string; error_description?: string }; } catch {}
    if (payload.error === "invalid_grant") {
      await ref.update({
        status: "revoked",
        lastError: { code: "invalid_grant", at: Date.now(), message: payload.error_description ?? "" },
      });
      throw new GoogleApiError("revoked", "user revoked access");
    }
    throw new GoogleApiError("transient", payload.error ?? `token refresh ${res.status}`, res.status);
  }
  const tokens = await res.json() as { access_token: string; expires_in: number };
  const expiresAt = Date.now() + tokens.expires_in * 1000;
  await ref.update({
    accessToken: tokens.access_token,
    accessTokenExpiresAt: expiresAt,
  });
  return tokens.access_token;
}

/**
 * Exchange an authorization code for tokens. Used by the OAuth
 * callback route. Returns refresh_token (possibly empty if Google
 * already issued one to this app — caller must persist it iff present).
 */
export async function exchangeAuthCode(args: {
  code: string;
  redirectUri: string;
}): Promise<{ accessToken: string; refreshToken?: string; expiresIn: number; idToken?: string }> {
  const body = new URLSearchParams({
    code: args.code,
    client_id: required("GOOGLE_OAUTH_CLIENT_ID"),
    client_secret: required("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirect_uri: args.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    let payload: { error?: string } = {};
    try { payload = await res.json() as { error?: string }; } catch {}
    throw new GoogleApiError("fatal", payload.error ?? `code exchange ${res.status}`, res.status);
  }
  const t = await res.json() as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string };
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in, idToken: t.id_token };
}

export async function fetchUserinfo(accessToken: string): Promise<{ email: string; name?: string; sub: string }> {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new GoogleApiError("fatal", `userinfo ${res.status}`, res.status);
  return res.json() as Promise<{ email: string; name?: string; sub: string }>;
}

export async function revokeToken(refreshToken: string): Promise<void> {
  await fetch(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method: "POST" });
}

/* ───────────── retry envelope ───────────── */

async function withRetry<T>(fn: () => Promise<T>, label: string, maxAttempts = 4): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const apiErr = err instanceof GoogleApiError ? err : null;
      const retryable = apiErr ? apiErr.kind === "rate-limited" || apiErr.kind === "transient" : true;
      if (!retryable || attempt === maxAttempts) break;
      const delay = backoffSchedule(attempt);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  if (last instanceof Error) throw last;
  throw new GoogleApiError("fatal", `${label}: unknown error`);
}

/* ───────────── REST methods ───────────── */

interface ListEventsResponse {
  items?: GoogleEvent[];
  nextPageToken?: string;
}

async function callJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (res.status === 401) throw new GoogleApiError("unauthenticated", "401 from google");
  if (res.status === 429) throw new GoogleApiError("rate-limited", "429");
  if (res.status >= 500)  throw new GoogleApiError("transient", `5xx ${res.status}`);
  if (!res.ok) throw new GoogleApiError("fatal", `${res.status} ${res.statusText}`, res.status);
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

export function makeServerHttpClient(): GoogleHttpClient {
  return {
    async listEvents({ accessToken, timeMin, timeMax, pageToken }) {
      const params = new URLSearchParams({
        timeMin,
        timeMax,
        singleEvents: "true",          // expand recurring on the wire
        orderBy: "startTime",
        maxResults: "250",
      });
      if (pageToken) params.set("pageToken", pageToken);
      const url = `${CALENDAR_BASE}/calendars/primary/events?${params.toString()}`;
      const data = await withRetry(() => callJson<ListEventsResponse>(url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      }), "listEvents");
      return { events: data.items ?? [], nextPageToken: data.nextPageToken };
    },
    async insertEvent({ accessToken, calendarId, event }) {
      const url = `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events`;
      return withRetry(() => callJson<GoogleEvent>(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(event),
      }), "insertEvent");
    },
    async patchEvent({ accessToken, calendarId, eventId, patch, etag }) {
      const url = `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      };
      if (etag) headers["If-Match"] = etag;
      return withRetry(() => callJson<GoogleEvent>(url, {
        method: "PATCH",
        headers,
        body: JSON.stringify(patch),
      }), "patchEvent");
    },
    async deleteEvent({ accessToken, calendarId, eventId }) {
      const url = `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;
      await withRetry(() => callJson<unknown>(url, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      }), "deleteEvent");
    },
    async refresh({ refreshToken }) {
      const body = new URLSearchParams({
        client_id: required("GOOGLE_OAUTH_CLIENT_ID"),
        client_secret: required("GOOGLE_OAUTH_CLIENT_SECRET"),
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      });
      const res = await fetch(OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({})) as { error?: string };
        if (payload.error === "invalid_grant") throw new GoogleApiError("revoked", "user revoked access");
        throw new GoogleApiError("transient", payload.error ?? `refresh ${res.status}`, res.status);
      }
      const t = await res.json() as { access_token: string; expires_in: number };
      return { accessToken: t.access_token, expiresIn: t.expires_in };
    },
  };
}

/* ───────────── push (watch) channel ───────────── */

export interface WatchResult {
  channelId: string;
  resourceId: string;
  expirationMs: number;
}

/**
 * Register a Google Calendar push channel that will POST to our
 * webhook whenever events on the user's primary calendar change.
 * Channels expire after ≤ 1 week; the cron job renews them.
 */
export async function watchCalendar(args: {
  uid: string;
  webhookUrl: string;
  channelToken: string;
}): Promise<WatchResult> {
  const accessToken = await ensureFreshAccessToken(args.uid);
  const channelId = `forge_${args.uid}_${Date.now().toString(36)}`;
  const res = await fetch(`${CALENDAR_BASE}/calendars/primary/events/watch`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: channelId,
      type: "web_hook",
      address: args.webhookUrl,
      token: args.channelToken,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GoogleApiError("fatal", `watch ${res.status}: ${text}`, res.status);
  }
  const data = await res.json() as { id: string; resourceId: string; expiration?: string };
  return {
    channelId: data.id,
    resourceId: data.resourceId,
    expirationMs: data.expiration ? Number(data.expiration) : Date.now() + 7 * 86_400_000,
  };
}

export async function stopWatch(args: { uid: string; channelId: string; resourceId: string }): Promise<void> {
  const accessToken = await ensureFreshAccessToken(args.uid);
  await fetch(`${CALENDAR_BASE}/channels/stop`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ id: args.channelId, resourceId: args.resourceId }),
  });
}

/* ───────────── helpers ───────────── */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new GoogleApiError("fatal", `env ${name} is required`);
  return v;
}

/** Convenience wrapper that callers use after a successful exchange. */
export async function persistGoogleConnection(args: {
  uid: string;
  accessToken: string;
  refreshToken: string | undefined;
  expiresIn: number;
  account: { email: string; displayName: string };
  scopes: string[];
}): Promise<void> {
  const fs = getAdminFirestore();
  const ref = fs.doc(`users/${args.uid}/integrations/google`);
  const update: Partial<IntegrationDoc> & { connectedAt: FieldValue | number } = {
    status: "connected",
    account: args.account,
    accessToken: args.accessToken,
    accessTokenExpiresAt: Date.now() + args.expiresIn * 1000,
    scopes: args.scopes,
    connectedAt: FieldValue.serverTimestamp() as unknown as number,
  };
  // Only overwrite the refresh token if Google issued a new one (it
  // only does that on first consent or when access_type=offline+prompt=consent).
  if (args.refreshToken) {
    update.refreshTokenEncrypted = encrypt(args.refreshToken);
  }
  await ref.set(update, { merge: true });
}
