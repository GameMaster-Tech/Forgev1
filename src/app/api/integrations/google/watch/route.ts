/**
 * POST /api/integrations/google/watch
 *
 * Registers (or renews) a Google Calendar push channel for the user's
 * primary calendar. Persists channel id + resource id + a per-channel
 * token to `users/{uid}/integrations/google.pushChannel`.
 *
 * Channels expire ≤ 7 days. The cron job at /api/cron/gcal-renew-watch
 * re-registers them daily.
 *
 * Required env:
 *   GOOGLE_WEBHOOK_URL  — publicly reachable HTTPS URL pointing at
 *                         /api/integrations/google/webhook
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { encrypt, randomToken } from "@/lib/server/crypto";
import { stopWatch, watchCalendar, type IntegrationDoc } from "@/lib/server/google-api";

export async function POST(req: NextRequest): Promise<Response> {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const webhook = process.env.GOOGLE_WEBHOOK_URL;
  if (!webhook) return NextResponse.json({ error: "GOOGLE_WEBHOOK_URL not configured" }, { status: 500 });

  const fs = getAdminFirestore();
  const ref = fs.doc(`users/${user.uid}/integrations/google`);
  const snap = await ref.get();
  const current = snap.exists ? (snap.data() as IntegrationDoc) : null;

  // Stop the previous channel before registering a new one.
  if (current?.pushChannel) {
    try {
      await stopWatch({ uid: user.uid, channelId: current.pushChannel.id, resourceId: current.pushChannel.resourceId });
    } catch {/* ignore — may already be gone */}
  }

  const channelToken = randomToken(24);
  try {
    const result = await watchCalendar({ uid: user.uid, webhookUrl: webhook, channelToken });
    await ref.set({
      pushChannel: {
        id: result.channelId,
        resourceId: result.resourceId,
        expirationMs: result.expirationMs,
        tokenEncrypted: encrypt(channelToken),
      },
    } as Partial<IntegrationDoc>, { merge: true });
    return NextResponse.json({ ok: true, expiresAt: new Date(result.expirationMs).toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "watch failed";
    return NextResponse.json({ ok: false, error: message }, { status: 502 });
  }
}
