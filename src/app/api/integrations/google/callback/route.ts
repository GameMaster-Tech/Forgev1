/**
 * GET /api/integrations/google/callback
 *
 * OAuth redirect target. Steps:
 *
 *   1. Verify the signed `state` to recover the originating uid.
 *   2. Exchange the auth code for tokens.
 *   3. Pull email + display name via /userinfo.
 *   4. Persist (refresh_token encrypted at rest) to
 *      `users/{uid}/integrations/google`.
 *   5. Redirect to `state.returnTo`.
 *
 * Failure modes — `?error=...` on the redirect URL so the UI can show
 * a clear toast.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyState } from "@/lib/server/crypto";
import { exchangeAuthCode, fetchUserinfo, persistGoogleConnection, GoogleApiError } from "@/lib/server/google-api";

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
];

export async function GET(req: NextRequest): Promise<Response> {
  const code = req.nextUrl.searchParams.get("code");
  const stateToken = req.nextUrl.searchParams.get("state");
  const oauthError = req.nextUrl.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(new URL(`/calendar?integration=denied&reason=${encodeURIComponent(oauthError)}`, req.url));
  }
  if (!code || !stateToken) {
    return NextResponse.redirect(new URL("/calendar?integration=failed&reason=missing-params", req.url));
  }

  const state = verifyState(stateToken);
  if (!state || !state.uid) {
    return NextResponse.redirect(new URL("/calendar?integration=failed&reason=bad-state", req.url));
  }

  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!redirectUri) {
    return NextResponse.redirect(new URL("/calendar?integration=failed&reason=server-misconfigured", req.url));
  }

  try {
    const tokens = await exchangeAuthCode({ code, redirectUri });
    const profile = await fetchUserinfo(tokens.accessToken);
    await persistGoogleConnection({
      uid: state.uid,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresIn: tokens.expiresIn,
      account: { email: profile.email, displayName: profile.name ?? profile.email },
      scopes: SCOPES,
    });
    const returnTo = state.returnTo ?? "/calendar?integration=connected";
    return NextResponse.redirect(new URL(returnTo, req.url));
  } catch (err) {
    const code = err instanceof GoogleApiError ? err.kind : "unknown";
    return NextResponse.redirect(new URL(`/calendar?integration=failed&reason=${encodeURIComponent(code)}`, req.url));
  }
}
