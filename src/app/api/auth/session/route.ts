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
import { getAdminAuth } from "@/lib/firebase/admin";

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest): Promise<Response> {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return NextResponse.json(
      { error: "Authorization Bearer token required" },
      { status: 401 },
    );
  }
  const idToken = match[1].trim();
  if (!idToken) {
    return NextResponse.json({ error: "Empty token" }, { status: 401 });
  }

  try {
    // Verify the ID token freshness (rejects stale tokens > 5 min old
    // per Firebase docs) before minting the session cookie.
    const decoded = await getAdminAuth().verifyIdToken(idToken, true);
    const ageSeconds = Math.floor(Date.now() / 1000) - decoded.auth_time;
    if (ageSeconds > 5 * 60) {
      return NextResponse.json(
        { error: "Re-authenticate to issue a session." },
        { status: 401 },
      );
    }
    const sessionCookie = await getAdminAuth().createSessionCookie(idToken, {
      expiresIn: FIVE_DAYS_MS,
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
  } catch (err) {
    console.error("[auth.session] mint failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Failed to mint session cookie." },
      { status: 401 },
    );
  }
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
