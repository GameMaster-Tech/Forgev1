/**
 * GET /api/integrations/google/status
 *
 * Reads the user's Google integration document and returns the bits the
 * client needs to render the Calendar > Integrations card. Never echoes
 * the refresh token, the access token, or the encrypted blob — just the
 * connection state and metadata.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import type { IntegrationDoc } from "@/lib/server/google-api";

interface PublicStatus {
  status: "disconnected" | "connecting" | "connected" | "error";
  account?: {
    email: string;
    displayName: string;
    primaryCalendarId: string;
    scopes: string[];
  };
  lastSyncedAt?: string;
  errorMessage?: string;
  /**
   * `true` only when GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_REDIRECT_URI
   * are both present in the server env. The UI uses this to render a
   * clear "OAuth not configured — set GOOGLE_OAUTH_* in .env.local"
   * message instead of letting the user click a button that 500s.
   */
  configured: boolean;
}

export async function GET(req: NextRequest): Promise<Response> {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const configured =
    !!process.env.GOOGLE_OAUTH_CLIENT_ID &&
    !!process.env.GOOGLE_OAUTH_REDIRECT_URI;

  const fs = getAdminFirestore();
  const snap = await fs.doc(`users/${user.uid}/integrations/google`).get();
  if (!snap.exists) {
    const empty: PublicStatus = { status: "disconnected", configured };
    return NextResponse.json(empty);
  }

  const data = snap.data() as IntegrationDoc;
  // The server schema uses 'revoked' as a distinct state; the public
  // surface collapses it into 'error' so the UI only ever has to handle
  // 4 cases.
  const publicStatus: PublicStatus["status"] =
    data.status === "revoked"
      ? "error"
      : data.status === "connected"
        ? "connected"
        : "disconnected";

  const out: PublicStatus = { status: publicStatus, configured };
  if (data.account) {
    out.account = {
      email: data.account.email,
      displayName: data.account.displayName ?? data.account.email,
      primaryCalendarId: "primary",
      scopes: data.scopes ?? [],
    };
  }
  if (typeof data.lastSyncedAt === "number") {
    out.lastSyncedAt = new Date(data.lastSyncedAt).toISOString();
  }
  if (data.lastError) {
    out.errorMessage = data.lastError.message;
  }
  return NextResponse.json(out);
}
