"use client";

/**
 * authedFetch — token-resilient fetch for Forge's API routes.
 *
 * The whole reason users get "randomly" 401'd mid-session is a stale
 * Firebase ID token: tokens live ~1 hour, and a request fired in the
 * narrow window around expiry (or just after a network hiccup paused the
 * SDK's background refresh) goes out with a dead token.
 *
 * This wrapper closes that gap:
 *   1. Attaches the current ID token (cached — cheap).
 *   2. On a 401/403, force-refreshes the token once and retries. A truly
 *      expired token is replaced transparently; the user never sees it.
 *   3. If there's no signed-in user at all, it doesn't pretend — the
 *      caller gets the response and AuthGuard handles the redirect.
 */

import { auth } from "./config";

/** Build an Authorization header with a (optionally forced-fresh) token. */
export async function getAuthHeaders(forceRefresh = false): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) return {};
  try {
    const token = await user.getIdToken(forceRefresh);
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

/**
 * fetch() that always carries a fresh-enough ID token and retries once
 * with a force-refreshed token on an auth failure.
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  const auth1 = await getAuthHeaders(false);
  for (const [k, v] of Object.entries(auth1)) headers.set(k, v);

  let res = await fetch(input, { ...init, headers });

  // One transparent retry on an auth failure with a forced-fresh token.
  if ((res.status === 401 || res.status === 403) && auth.currentUser) {
    const fresh = await getAuthHeaders(true);
    if (fresh.Authorization) {
      const retryHeaders = new Headers(init.headers);
      for (const [k, v] of Object.entries(fresh)) retryHeaders.set(k, v);
      res = await fetch(input, { ...init, headers: retryHeaders });
    }
  }
  return res;
}

/** Convenience JSON POST with auth + 401-retry. */
export async function authedPostJson(
  url: string,
  body: unknown,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  return authedFetch(url, { ...init, method: "POST", headers, body: JSON.stringify(body) });
}
