/**
 * API auth helper — validates the caller's Firebase ID token.
 *
 * Security rule: every API route that touches user data or calls a metered
 * upstream (EXA / Anthropic / Crossref / Voyage / Google Calendar) MUST
 * authenticate the caller via `requireUser`. Public endpoints (none today,
 * but reserved for future health checks) explicitly opt out with a
 * documented exemption comment in the route file.
 *
 * The client sends the Firebase ID token in `Authorization: Bearer <token>`.
 * `requireUser` verifies it server-side via the Admin SDK and returns the
 * `uid`. Verified tokens carry minimal claims (issuer, audience, exp);
 * never trust uid hints in the body or query string.
 *
 * Server-only — never import from a `"use client"` file.
 */

import "server-only";
import { getAdminAuth } from "@/lib/firebase/admin";

export interface AuthedUser {
  uid: string;
  email: string | null;
}

/** Sentinel — `Response` when auth fails, `AuthedUser` when it succeeds. */
export type AuthResult = AuthedUser | Response;

export function isAuthFailure(r: AuthResult): r is Response {
  return r instanceof Response;
}

/**
 * Verify the Authorization Bearer token and return the resolved user, or
 * a fully-formed 401 Response if anything is off. Callers should pass the
 * Response straight back to the client.
 */
export async function requireUser(request: Request): Promise<AuthResult> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return unauthorized("Missing Authorization header");

  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return unauthorized("Authorization must be a Bearer token");

  const token = match[1].trim();
  if (!token) return unauthorized("Empty bearer token");

  try {
    const decoded = await getAdminAuth().verifyIdToken(token, /* checkRevoked */ true);
    return { uid: decoded.uid, email: decoded.email ?? null };
  } catch {
    // Never log the token. Never echo verifier error details to the client —
    // they are useful only to attackers and our server logs already have them.
    return unauthorized("Invalid or expired token");
  }
}

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
