/**
 * GET /api/integrations/notion/start
 *
 * Issues an authenticated redirect to Notion's OAuth consent screen.
 * Mirrors the Google start route — `state` is an HMAC-signed bundle
 * of { uid, nonce, returnTo } so the callback can recover the user
 * without trusting query params.
 *
 * Required env:
 *   NOTION_OAUTH_CLIENT_ID
 *   NOTION_OAUTH_REDIRECT_URI
 *   OAUTH_STATE_SECRET
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/auth";
import { randomToken, signState } from "@/lib/server/crypto";

export async function GET(req: NextRequest): Promise<Response> {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const clientId = process.env.NOTION_OAUTH_CLIENT_ID;
  const redirectUri = process.env.NOTION_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "notion oauth not configured" }, { status: 500 });
  }

  const returnTo =
    req.nextUrl.searchParams.get("returnTo") ?? "/settings?integration=notion-connected";
  // Block open-redirects — only same-origin paths.
  const safeReturnTo =
    returnTo.startsWith("/") && !returnTo.startsWith("//")
      ? returnTo
      : "/settings?integration=notion-connected";

  const state = signState({
    uid: user.uid,
    nonce: randomToken(16),
    returnTo: safeReturnTo,
  });

  // Notion's authorize URL. `owner=user` requests a user-scoped grant
  // (vs workspace-scoped) — the bot inherits the granting user's
  // page permissions. `response_type=code` triggers the standard
  // auth-code → token exchange in the callback.
  const authUrl = new URL("https://api.notion.com/v1/oauth/authorize");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("owner", "user");
  authUrl.searchParams.set("state", state);

  return NextResponse.redirect(authUrl.toString());
}
