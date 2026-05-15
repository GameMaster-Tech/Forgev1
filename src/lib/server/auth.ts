/**
 * Server-side auth — verifies a Firebase ID token from an incoming
 * request and returns the user's UID.
 *
 * Two transport options are supported:
 *
 *   1. `Authorization: Bearer <id-token>` header
 *      Use when the client calls fetch() with the current ID token.
 *
 *   2. `__session` cookie containing a Firebase session cookie
 *      Use after wiring the standard session-cookie flow
 *      (`auth.createSessionCookie` server-side after sign-in).
 *
 * Returns `null` for any failure — caller is responsible for issuing
 * the 401 response. Never throws on the happy/unhappy split.
 */

import "server-only";
import type { NextRequest } from "next/server";
import { getAdminAuth } from "../firebase/admin";

export interface VerifiedUser {
  uid: string;
  email?: string;
  emailVerified?: boolean;
  /** Optional team or org id propagated from custom claims. */
  teamId?: string;
}

export async function verifyRequest(req: NextRequest): Promise<VerifiedUser | null> {
  const idToken = readIdToken(req);
  if (idToken) {
    try {
      const decoded = await getAdminAuth().verifyIdToken(idToken, true);
      return {
        uid: decoded.uid,
        email: decoded.email,
        emailVerified: decoded.email_verified,
        teamId: typeof decoded.teamId === "string" ? decoded.teamId : undefined,
      };
    } catch {
      return null;
    }
  }
  const sessionCookie = req.cookies.get("__session")?.value;
  if (sessionCookie) {
    try {
      const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true);
      return {
        uid: decoded.uid,
        email: decoded.email,
        emailVerified: decoded.email_verified,
        teamId: typeof decoded.teamId === "string" ? decoded.teamId : undefined,
      };
    } catch {
      return null;
    }
  }
  return null;
}

function readIdToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** Verify a Cloud Scheduler / cron secret. Use for /api/cron/* routes. */
export function verifyCronSecret(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    if (process.env.NODE_ENV === "production") return false;
    return true; // dev mode: allow local cron tests
  }
  const header = req.headers.get("x-cron-secret") ?? req.headers.get("authorization");
  if (!header) return false;
  const provided = header.replace(/^Bearer\s+/i, "");
  // Avoid string-comparison timing leaks.
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

/**
 * Verify Google's push-notification webhook authenticity. Google signs
 * the `X-Goog-Channel-Token` header with the token you supplied when
 * registering the channel. We compare in constant time.
 */
export function verifyGoogleWebhookToken(req: NextRequest, expected: string): boolean {
  const provided = req.headers.get("x-goog-channel-token") ?? "";
  if (provided.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < provided.length; i++) mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}
