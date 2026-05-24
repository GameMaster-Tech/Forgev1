/**
 * Notion integration — client helper.
 *
 * Mirrors `src/lib/calendar/google.ts`. Talks to the real server routes:
 *
 *   GET  /api/integrations/notion/start       — kicks off OAuth (redirect)
 *   GET  /api/integrations/notion/callback    — Notion → here, token exchange
 *   GET  /api/integrations/notion/status      — current state for the UI
 *   POST /api/integrations/notion/sync        — pull the visible workspace
 *   POST /api/integrations/notion/disconnect  — revoke + cleanup
 *
 * Connect flow mirrors Google: mint an HttpOnly session cookie so the
 * top-level navigation to /start carries auth, then redirect.
 */

import { auth } from "@/lib/firebase/config";
import type {
  NotionAccount,
  NotionIntegrationStatus,
  NotionSyncStats,
} from "@/lib/integrations/notion/types";

export interface NotionIntegrationState {
  status: NotionIntegrationStatus;
  account?: NotionAccount | null;
  connectedAt?: number | null;
  lastSyncedAt?: number | null;
  stats?: {
    projects: number;
    documents: number;
    events: number;
    databases: number;
  } | null;
  lastError?: { code: string; at: number; message: string } | null;
  /** `true` when the server has NOTION_OAUTH_* env vars set. */
  configured?: boolean;
  /** Set by the helper itself when an action fails locally. */
  errorMessage?: string;
}

const STATUS_URL = "/api/integrations/notion/status";
const START_URL = "/api/integrations/notion/start";
const SYNC_URL = "/api/integrations/notion/sync";
const DISCONNECT_URL = "/api/integrations/notion/disconnect";

async function freshAuthHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  try {
    // Force-refresh — required for the session-cookie mint at
    // /api/auth/session (createSessionCookie rejects ID tokens with
    // auth_time older than 5 min) and consistent with the rest of
    // the AI-feature calls.
    const token = await user.getIdToken(true);
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

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

let stateCache: NotionIntegrationState = { status: "disconnected" };

export function readNotionState(): NotionIntegrationState {
  return stateCache;
}

export async function refreshNotionState(): Promise<NotionIntegrationState> {
  try {
    const headers = await authHeaders();
    const res = await fetch(STATUS_URL, { headers, cache: "no-store" });
    if (!res.ok) {
      stateCache = { status: "disconnected" };
      return stateCache;
    }
    stateCache = (await res.json()) as NotionIntegrationState;
    return stateCache;
  } catch {
    stateCache = { status: "disconnected" };
    return stateCache;
  }
}

/**
 * Start the Notion OAuth flow. Same architecture as Google: mint a
 * session cookie first so the top-level navigation to /start carries
 * auth (Bearer headers don't survive top-level nav).
 */
export async function connectNotion(): Promise<NotionIntegrationState> {
  if (typeof window === "undefined") return stateCache;
  const returnTo = window.location.pathname + (window.location.search ?? "");
  const url = `${START_URL}?returnTo=${encodeURIComponent(returnTo)}`;

  try {
    const headers = await freshAuthHeaders();
    if (!headers.Authorization) {
      stateCache = {
        ...stateCache,
        status: stateCache.status,
        errorMessage: "Please sign in again to connect Notion.",
      };
      return stateCache;
    }
    const session = await fetch("/api/auth/session", {
      method: "POST",
      headers,
      credentials: "same-origin",
    });
    if (!session.ok) {
      let detail = "Couldn't open a Notion session — sign in again.";
      try {
        const body = (await session.json()) as { error?: string };
        if (body.error) detail = body.error;
      } catch {
        /* keep default */
      }
      stateCache = { ...stateCache, errorMessage: detail };
      return stateCache;
    }
    window.location.href = url;
    return stateCache;
  } catch (err) {
    stateCache = {
      ...stateCache,
      errorMessage:
        err instanceof Error ? err.message : "Couldn't start Notion sign-in.",
    };
    return stateCache;
  }
}

export async function disconnectNotion(): Promise<NotionIntegrationState> {
  try {
    const headers = await authHeaders();
    await fetch(DISCONNECT_URL, { method: "POST", headers });
  } catch {
    /* server already idempotent */
  }
  stateCache = { status: "disconnected" };
  return stateCache;
}

export interface NotionSyncResult extends Partial<NotionSyncStats> {
  ok: boolean;
  error?: string;
}

export async function runNotionSync(): Promise<NotionSyncResult> {
  try {
    const headers = await authHeaders();
    const res = await fetch(SYNC_URL, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      let detail = `Sync failed (${res.status})`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body.error) detail = body.error;
      } catch {
        /* fall through */
      }
      if (res.status === 410) {
        stateCache = {
          ...stateCache,
          status: "revoked",
          errorMessage: "Notion access expired. Reconnect to keep syncing.",
        };
      }
      return { ok: false, error: detail };
    }
    const data = (await res.json()) as NotionSyncResult;
    // Refresh status so the panel shows new lastSyncedAt + stats.
    await refreshNotionState();
    return { ...data, ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Sync failed",
    };
  }
}
