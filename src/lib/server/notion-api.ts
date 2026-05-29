/**
 * Server-side Notion API client.
 *
 * Thin `fetch` wrapper over the Notion REST API. Handles:
 *
 *   • OAuth code exchange (`POST /oauth/token`)
 *   • Persisting the integration doc (encrypted token at rest)
 *   • `search` / `databases.query` / `blocks.children.list` pagination
 *   • Exponential backoff on 429/5xx
 *   • Typed errors (`NotionApiError`) so callers can branch
 *
 * Server-only — never import from a `"use client"` file. Token never
 * leaves this module unencrypted.
 */

import "server-only";
import { encrypt, decrypt } from "./crypto";
import { getAdminFirestore } from "../firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import type {
  NotionAccount,
  NotionBlock,
  NotionDatabase,
  NotionIntegrationDoc,
  NotionPage,
  NotionSearchResult,
} from "@/lib/integrations/notion/types";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = process.env.NOTION_API_VERSION ?? "2022-06-28";
const OAUTH_TOKEN_URL = `${NOTION_API}/oauth/token`;
const REVOKE_URL = `${NOTION_API}/oauth/revoke`;

/* ─────────────────────────── errors ─────────────────────────── */

export type NotionApiErrorKind =
  | "unauthenticated"
  | "revoked"
  | "rate-limited"
  | "transient"
  | "fatal";

export class NotionApiError extends Error {
  constructor(
    public kind: NotionApiErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "NotionApiError";
  }
}

/* ─────────────────────────── env ─────────────────────────── */

function required(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

export function notionConfigured(): boolean {
  return !!(
    process.env.NOTION_OAUTH_CLIENT_ID &&
    process.env.NOTION_OAUTH_CLIENT_SECRET &&
    process.env.NOTION_OAUTH_REDIRECT_URI
  );
}

/* ─────────────────────────── token lifecycle ─────────────────────────── */

const SAFETY_WINDOW_MS = 5 * 60_000;

/**
 * Return a working bearer token for the user, refreshing it via
 * Notion's `refresh_token` grant if we have one and the access token
 * is about to expire. Notion's "internal integration" tokens don't
 * expire — in that case we just return the stored access token.
 */
export async function ensureFreshNotionToken(uid: string): Promise<string> {
  const fs = getAdminFirestore();
  const ref = fs.doc(`users/${uid}/integrations/notion`);
  const snap = await ref.get();
  if (!snap.exists) throw new NotionApiError("unauthenticated", "no notion integration");
  const doc = snap.data() as NotionIntegrationDoc;
  if (doc.status !== "connected") {
    throw new NotionApiError("unauthenticated", `integration is ${doc.status}`);
  }
  if (!doc.accessTokenEncrypted) {
    throw new NotionApiError("unauthenticated", "no access token on file");
  }
  const accessToken = decrypt(doc.accessTokenEncrypted);
  const expiresAt = doc.accessTokenExpiresAt;
  if (!expiresAt || expiresAt - Date.now() > SAFETY_WINDOW_MS) {
    return accessToken;
  }
  // Need refresh.
  if (!doc.refreshTokenEncrypted) {
    // Non-expiring token — just hand it back.
    return accessToken;
  }
  const refreshToken = decrypt(doc.refreshTokenEncrypted);
  const refreshed = await callOAuth({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  await ref.set(
    {
      accessTokenEncrypted: encrypt(refreshed.access_token),
      ...(refreshed.refresh_token
        ? { refreshTokenEncrypted: encrypt(refreshed.refresh_token) }
        : {}),
      accessTokenExpiresAt: refreshed.expires_in
        ? Date.now() + refreshed.expires_in * 1000
        : FieldValue.delete(),
    } as Partial<NotionIntegrationDoc>,
    { merge: true },
  );
  return refreshed.access_token;
}

interface NotionOAuthResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  bot_id: string;
  workspace_id: string;
  workspace_name?: string | null;
  workspace_icon?: string | null;
  owner?:
    | { type: "user"; user: { id: string; name?: string; person?: { email?: string } } }
    | { type: "workspace"; workspace: true };
  token_type: "bearer";
}

async function callOAuth(
  params: Record<string, string>,
): Promise<NotionOAuthResponse> {
  const clientId = required("NOTION_OAUTH_CLIENT_ID");
  const clientSecret = required("NOTION_OAUTH_CLIENT_SECRET");
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    let payload: { error?: string; error_description?: string } = {};
    try {
      payload = (await res.json()) as { error?: string; error_description?: string };
    } catch {
      /* fall through */
    }
    if (payload.error === "invalid_grant") {
      throw new NotionApiError("revoked", payload.error_description ?? "invalid_grant");
    }
    throw new NotionApiError("fatal", payload.error ?? `oauth ${res.status}`, res.status);
  }
  return (await res.json()) as NotionOAuthResponse;
}

/**
 * Exchange the OAuth authorization code for a token + persist the
 * integration doc. Called from the callback route.
 */
export async function persistNotionConnection(args: {
  uid: string;
  code: string;
  redirectUri: string;
}): Promise<NotionAccount> {
  const tokens = await callOAuth({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
  });
  const account: NotionAccount = {
    workspaceId: tokens.workspace_id,
    workspaceName: tokens.workspace_name ?? "Notion workspace",
    workspaceIcon: tokens.workspace_icon ?? null,
    botId: tokens.bot_id,
    ownerName:
      tokens.owner && tokens.owner.type === "user"
        ? tokens.owner.user.name ?? null
        : null,
    ownerEmail:
      tokens.owner && tokens.owner.type === "user"
        ? tokens.owner.user.person?.email ?? null
        : null,
  };
  const fs = getAdminFirestore();
  const ref = fs.doc(`users/${args.uid}/integrations/notion`);
  const update: Partial<NotionIntegrationDoc> & Record<string, unknown> = {
    status: "connected",
    account,
    accessTokenEncrypted: encrypt(tokens.access_token),
    connectedAt: Date.now(),
    scopes: [],
    lastError: FieldValue.delete() as unknown as undefined,
  };
  if (tokens.refresh_token) {
    update.refreshTokenEncrypted = encrypt(tokens.refresh_token);
  }
  if (tokens.expires_in) {
    update.accessTokenExpiresAt = Date.now() + tokens.expires_in * 1000;
  }
  await ref.set(update, { merge: true });
  return account;
}

/**
 * Revoke the token upstream + flip the integration doc to disconnected.
 * Idempotent — failing to reach Notion still flips the local flag so
 * the user isn't stuck.
 */
export async function disconnectNotion(uid: string): Promise<void> {
  const fs = getAdminFirestore();
  const ref = fs.doc(`users/${uid}/integrations/notion`);
  const snap = await ref.get();
  if (snap.exists) {
    const doc = snap.data() as NotionIntegrationDoc;
    if (doc.accessTokenEncrypted) {
      try {
        const token = decrypt(doc.accessTokenEncrypted);
        await fetch(REVOKE_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            "Notion-Version": NOTION_VERSION,
          },
          body: JSON.stringify({}),
        });
      } catch {
        /* upstream revoke is best-effort */
      }
    }
  }
  await ref.set(
    {
      status: "disconnected",
      accessTokenEncrypted: FieldValue.delete() as unknown as undefined,
      refreshTokenEncrypted: FieldValue.delete() as unknown as undefined,
      accessTokenExpiresAt: FieldValue.delete() as unknown as undefined,
    } as Partial<NotionIntegrationDoc>,
    { merge: true },
  );
}

/* ─────────────────────────── HTTP envelope ─────────────────────────── */

const RETRYABLE = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

async function notionFetch<T>(
  token: string,
  path: string,
  init?: { method?: "GET" | "POST" | "PATCH" | "DELETE"; body?: unknown },
): Promise<T> {
  let attempt = 0;
  let lastErr: unknown;
  while (attempt < MAX_ATTEMPTS) {
    attempt += 1;
    const res = await fetch(`${NOTION_API}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    if (res.ok) {
      return (await res.json()) as T;
    }
    let payload: { code?: string; message?: string } = {};
    try {
      payload = (await res.json()) as { code?: string; message?: string };
    } catch {
      /* keep defaults */
    }
    if (res.status === 401) {
      throw new NotionApiError("unauthenticated", payload.message ?? "unauthorized", 401);
    }
    if (res.status === 403 && payload.code === "restricted_resource") {
      throw new NotionApiError("fatal", "Notion bot doesn't have access to that resource", 403);
    }
    if (RETRYABLE.has(res.status) && attempt < MAX_ATTEMPTS) {
      const backoff = Math.min(2_000 * attempt, 8_000);
      lastErr = new NotionApiError(
        res.status === 429 ? "rate-limited" : "transient",
        payload.message ?? `notion ${res.status}`,
        res.status,
      );
      await new Promise((r) => setTimeout(r, backoff));
      continue;
    }
    throw new NotionApiError(
      "fatal",
      payload.message ?? `notion ${res.status}`,
      res.status,
    );
  }
  if (lastErr instanceof Error) throw lastErr;
  throw new NotionApiError("fatal", "notion request failed");
}

/* ─────────────────────────── high-level methods ─────────────────────────── */

interface PaginatedResponse<T> {
  results: T[];
  next_cursor: string | null;
  has_more: boolean;
}

/**
 * Walk the entire workspace via `POST /v1/search` with no filter.
 * Yields every page + database the bot has been granted access to.
 * Paginates automatically; capped at `maxItems` so a 50 000-page
 * workspace doesn't take down a serverless invocation.
 */
export async function searchAll(
  token: string,
  maxItems = 500,
): Promise<NotionSearchResult[]> {
  const out: NotionSearchResult[] = [];
  let cursor: string | null = null;
  while (out.length < maxItems) {
    const body: { page_size: number; start_cursor?: string } = {
      page_size: Math.min(100, maxItems - out.length),
    };
    if (cursor) body.start_cursor = cursor;
    const page: PaginatedResponse<NotionSearchResult> = await notionFetch(
      token,
      "/search",
      { method: "POST", body },
    );
    out.push(...page.results);
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return out;
}

/** Fetch a single page (without its block children). */
export async function getPage(token: string, pageId: string): Promise<NotionPage> {
  return notionFetch<NotionPage>(token, `/pages/${pageId}`);
}

/** Fetch a single database. */
export async function getDatabase(token: string, databaseId: string): Promise<NotionDatabase> {
  return notionFetch<NotionDatabase>(token, `/databases/${databaseId}`);
}

/**
 * List a page's direct block children. Caller recurses if any block
 * has `has_children: true` and the recursion is worthwhile (we cap
 * depth in the converter to avoid runaway nesting).
 */
export async function listBlockChildren(
  token: string,
  blockId: string,
  maxBlocks = 500,
): Promise<NotionBlock[]> {
  const out: NotionBlock[] = [];
  let cursor: string | null = null;
  while (out.length < maxBlocks) {
    const qs = new URLSearchParams({ page_size: String(Math.min(100, maxBlocks - out.length)) });
    if (cursor) qs.set("start_cursor", cursor);
    const page: PaginatedResponse<NotionBlock> = await notionFetch(
      token,
      `/blocks/${blockId}/children?${qs.toString()}`,
    );
    out.push(...page.results);
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return out;
}

/** Query every row of a database. Returns pages — they carry properties. */
export async function queryDatabase(
  token: string,
  databaseId: string,
  maxRows = 500,
): Promise<NotionPage[]> {
  const out: NotionPage[] = [];
  let cursor: string | null = null;
  while (out.length < maxRows) {
    const body: { page_size: number; start_cursor?: string } = {
      page_size: Math.min(100, maxRows - out.length),
    };
    if (cursor) body.start_cursor = cursor;
    const page: PaginatedResponse<NotionPage> = await notionFetch(
      token,
      `/databases/${databaseId}/query`,
      { method: "POST", body },
    );
    out.push(...page.results);
    if (!page.has_more || !page.next_cursor) break;
    cursor = page.next_cursor;
  }
  return out;
}
