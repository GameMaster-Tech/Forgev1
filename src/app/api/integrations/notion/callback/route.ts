/**
 * GET /api/integrations/notion/callback
 *
 * OAuth redirect target. Steps:
 *
 *   1. Verify the signed `state` to recover the originating uid.
 *   2. Exchange the auth code for a bearer token.
 *   3. Persist the encrypted token + workspace metadata to
 *      `users/{uid}/integrations/notion`.
 *   4. Redirect to `state.returnTo`.
 *
 * Failure modes — `?integration=notion-failed&reason=...` so the
 * settings UI can show a clear message.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyState } from "@/lib/server/crypto";
import { persistNotionConnection, NotionApiError } from "@/lib/server/notion-api";
import { log } from "@/lib/observability";

export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get("code");
  const stateToken = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");
  const t0 = Date.now();

  if (oauthError) {
    log.event("oauth.exchange", { provider: "notion", status: "denied", reason: oauthError });
    return NextResponse.redirect(
      new URL(`/settings?integration=notion-denied&reason=${encodeURIComponent(oauthError)}`, req.url),
    );
  }
  if (!code || !stateToken) {
    log.event("oauth.exchange", { provider: "notion", status: "error", reason: "missing-params" });
    return NextResponse.redirect(
      new URL("/settings?integration=notion-failed&reason=missing-params", req.url),
    );
  }

  const state = verifyState(stateToken);
  if (!state || !state.uid) {
    log.event("oauth.exchange", { provider: "notion", status: "error", reason: "bad-state" });
    return NextResponse.redirect(
      new URL("/settings?integration=notion-failed&reason=bad-state", req.url),
    );
  }

  const redirectUri = process.env.NOTION_OAUTH_REDIRECT_URI;
  if (!redirectUri) {
    log.event("oauth.exchange", { provider: "notion", status: "error", reason: "server-misconfigured" });
    return NextResponse.redirect(
      new URL("/settings?integration=notion-failed&reason=server-misconfigured", req.url),
    );
  }

  try {
    const account = await persistNotionConnection({
      uid: state.uid,
      code,
      redirectUri,
    });
    log.event("oauth.exchange", {
      provider: "notion",
      status: "ok",
      userId: state.uid,
      workspaceId: account.workspaceId,
      durationMs: Date.now() - t0,
    });
    const returnTo = state.returnTo ?? "/settings?integration=notion-connected";
    return NextResponse.redirect(new URL(returnTo, req.url));
  } catch (err) {
    const reason = err instanceof NotionApiError ? err.kind : "unknown";
    log.event("oauth.exchange", {
      provider: "notion",
      status: "error",
      userId: state.uid,
      reason,
      durationMs: Date.now() - t0,
    });
    log.error(err, { route: "notion.oauth.callback", uid: state.uid });
    return NextResponse.redirect(
      new URL(`/settings?integration=notion-failed&reason=${encodeURIComponent(reason)}`, req.url),
    );
  }
}
