/**
 * POST /api/auth/session — exchange an ID token for an HttpOnly session
 * cookie.
 *
 * The Forge UI runs entirely on Firebase ID tokens passed via the
 * `Authorization: Bearer` header. That model breaks for any flow that
 * needs a *top-level navigation* — most notably the Google Calendar
 * OAuth start (`/api/integrations/google/start`), where the browser
 * follows a 302 to Google's consent screen and can't send custom
 * headers on the way.
 *
 * The fix is the standard Firebase pattern: mint an HttpOnly session
 * cookie ahead of the redirect. `verifyRequest` already accepts the
 * `__session` cookie as a transport alongside Bearer, so the rest of
 * the server is unchanged.
 *
 * Cookie scope: `__session` is required by Firebase Hosting's CDN
 * (it's the only cookie name that's never stripped). Other deploys
 * are fine with any name; we keep `__session` for portability.
 *
 * DELETE clears the cookie on sign-out.
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import { signState } from "@/lib/server/crypto";

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest): Promise<Response> {
  // Verify the caller via the same robust verifier the rest of the app uses
  // (public-cert ID-token check, with a dev fallback). We deliberately do NOT
  // use Firebase `createSessionCookie`: that requires a service-account
  // SIGNING key, which this deployment doesn't provision — and its absence
  // was silently breaking the Google Calendar OAuth navigation (the cookie
  // never minted, so /start rejected the redirect as unauthenticated).
  const auth = await requireUser(req);
  if (isAuthFailure(auth)) return auth;

  // Mint our own HMAC-signed session cookie (OAUTH_STATE_SECRET) carrying the
  // uid + expiry. `verifyRequest` accepts it as a transport alongside Bearer,
  // so a top-level navigation (which can't send an Authorization header) can
  // still authenticate.
  const expMs = Date.now() + FIVE_DAYS_MS;
  const sessionCookie = signState({
    uid: auth.uid,
    email: auth.email ?? "",
    exp: String(expMs),
  });

  const res = NextResponse.json({ ok: true });
  res.cookies.set("__session", sessionCookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: FIVE_DAYS_MS / 1000,
  });
  return res;
}

export async function DELETE(): Promise<Response> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("__session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
