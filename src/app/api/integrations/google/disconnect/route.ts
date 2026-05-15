/**
 * POST /api/integrations/google/disconnect
 *
 * Revokes the user's refresh token, stops the push channel, clears
 * the integration document. Always succeeds (idempotent).
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { decrypt } from "@/lib/server/crypto";
import { revokeToken, stopWatch, type IntegrationDoc } from "@/lib/server/google-api";

export async function POST(req: NextRequest): Promise<Response> {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const fs = getAdminFirestore();
  const ref = fs.doc(`users/${user.uid}/integrations/google`);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ ok: true, alreadyDisconnected: true });

  const doc = snap.data() as IntegrationDoc;

  // Best-effort cleanup; failures don't block the disconnect.
  if (doc.pushChannel) {
    try {
      await stopWatch({ uid: user.uid, channelId: doc.pushChannel.id, resourceId: doc.pushChannel.resourceId });
    } catch {/* ignore */}
  }
  if (doc.refreshTokenEncrypted) {
    try {
      await revokeToken(decrypt(doc.refreshTokenEncrypted));
    } catch {/* ignore */}
  }

  await ref.set({
    status: "disconnected",
    accessToken: null,
    accessTokenExpiresAt: null,
    refreshTokenEncrypted: null,
    pushChannel: null,
  }, { merge: true });

  return NextResponse.json({ ok: true });
}
