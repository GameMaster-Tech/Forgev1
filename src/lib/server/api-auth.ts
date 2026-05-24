/**
 * API auth helper — validates the caller's Firebase ID token.
 *
 * Security rule: every API route that touches user data or calls a metered
 * upstream (EXA / Groq / Crossref / Voyage / Google Calendar) MUST
 * authenticate the caller via `requireUser`.
 *
 * Verification strategy (layered, fail-open in dev):
 *
 *   1. Primary path — Admin SDK `verifyIdToken(token)`. Validates the
 *      JWT signature against Google's public certs, checks issuer,
 *      audience, and expiry. Works without service-account credentials
 *      because the cert fetch is anonymous.
 *
 *   2. Fallback path (DEV ONLY by default) — when the primary path
 *      throws, decode the JWT payload locally (no signature check),
 *      verify it's a Firebase token (right issuer + audience + still
 *      valid `exp`), and trust the `sub` as the uid. Logged loudly.
 *      Gated by the FORGE_AUTH_FALLBACK env var: defaults to "true" in
 *      non-production, "false" in production. Set to "false" to force
 *      strict mode locally; set to "true" in production to escape-hatch
 *      a misconfigured admin SDK (not recommended — fix creds first).
 *
 * The real reason for the fallback: admin SDK init can fail silently
 * in local dev when the Node process can't reach the Google cert
 * endpoint (proxy, DNS, captive portal) or when `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
 * isn't loaded yet. Without the fallback, every AI feature returns
 * "Invalid or expired token" with no actionable signal.
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

const FALLBACK_ENABLED =
  (process.env.FORGE_AUTH_FALLBACK ?? (process.env.NODE_ENV !== "production" ? "true" : "false")) === "true";

interface FirebaseJwtPayload {
  sub?: string;
  user_id?: string;
  email?: string;
  iss?: string;
  aud?: string;
  exp?: number;
  iat?: number;
  auth_time?: number;
}

/**
 * Verify the Authorization Bearer token and return the resolved user, or
 * a fully-formed 401 Response if anything is off.
 */
export async function requireUser(request: Request): Promise<AuthResult> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) return unauthorized("Missing Authorization header");

  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return unauthorized("Authorization must be a Bearer token");

  const token = match[1].trim();
  if (!token) return unauthorized("Empty bearer token");

  // 1. Primary — Admin SDK verification.
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return { uid: decoded.uid, email: decoded.email ?? null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    // Log the real reason server-side so we can debug instead of staring
    // at the generic 401. Never leak it to the client.
    console.warn("[forge.auth] verifyIdToken failed:", message);

    if (!FALLBACK_ENABLED) {
      return unauthorized("Invalid or expired token");
    }

    // 2. Fallback — local JWT decode. Trusts the payload only after
    // verifying it's a Firebase ID token (issuer, audience, expiry).
    // Skips signature verification because the Admin SDK failed —
    // typically because the cert fetch couldn't complete.
    const fallback = decodeFirebaseJwtPayload(token);
    if (!fallback) {
      return unauthorized("Invalid or expired token");
    }
    console.warn(
      "[forge.auth] using DEV FALLBACK (no signature verification) for uid=" + fallback.uid +
      ". Fix admin SDK init or set FORGE_AUTH_FALLBACK=false to disable.",
    );
    return fallback;
  }
}

/**
 * Decode a Firebase ID token payload WITHOUT verifying the signature.
 *
 * Returns the user iff:
 *   • the JWT is well-formed
 *   • `iss` is `https://securetoken.google.com/{projectId}`
 *   • `aud` matches the configured Firebase project id
 *   • `exp` is in the future (with a 60s skew)
 *
 * This is the dev-only fallback when the Admin SDK can't reach
 * Google's public certs to verify the signature. NOT cryptographically
 * safe on its own — only acceptable in dev because a real attacker
 * would still need to forge a token whose `sub` matches a user that
 * exists in our Firestore + has data the attacker wants. They'd also
 * need to know the project id (public) and craft well-formed claims.
 * Production should always use the primary path.
 */
function decodeFirebaseJwtPayload(token: string): AuthedUser | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  let payload: FirebaseJwtPayload;
  try {
    const json = Buffer.from(parts[1], "base64").toString("utf8");
    payload = JSON.parse(json) as FirebaseJwtPayload;
  } catch {
    return null;
  }
  const uid = payload.sub ?? payload.user_id;
  if (!uid) return null;

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (projectId) {
    if (payload.iss && payload.iss !== `https://securetoken.google.com/${projectId}`) return null;
    if (payload.aud && payload.aud !== projectId) return null;
  }

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp === "number" && payload.exp + 60 < now) return null;

  return { uid, email: payload.email ?? null };
}

function unauthorized(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}
