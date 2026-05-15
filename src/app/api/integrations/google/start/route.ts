/**
 * GET /api/integrations/google/start
 *
 * Issues an authenticated redirect to Google's OAuth consent screen.
 * The `state` parameter is an HMAC-signed bundle of:
 *
 *   { uid, nonce, returnTo }
 *
 * Callback verifies the signature before trusting the redirect.
 *
 * Required env:
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_REDIRECT_URI
 *   OAUTH_STATE_SECRET
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/auth";
import { randomToken, signState } from "@/lib/server/crypto";

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

export async function GET(req: NextRequest): Promise<Response> {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const clientId    = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "google oauth not configured" }, { status: 500 });
  }

  const returnTo = req.nextUrl.searchParams.get("returnTo") ?? "/calendar?integration=connected";
  // Block open-redirects — only same-origin paths.
  const safeReturnTo = returnTo.startsWith("/") && !returnTo.startsWith("//")
    ? returnTo
    : "/calendar?integration=connected";

  const state = signState({
    uid: user.uid,
    nonce: randomToken(16),
    returnTo: safeReturnTo,
  });

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id",     clientId);
  authUrl.searchParams.set("redirect_uri",  redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("access_type",   "offline");
  authUrl.searchParams.set("prompt",        "consent"); // force refresh_token issuance
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("scope",         SCOPES.join(" "));
  authUrl.searchParams.set("state",         state);

  return NextResponse.redirect(authUrl.toString());
}
