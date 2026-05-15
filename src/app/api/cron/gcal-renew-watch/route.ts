/**
 * GET /api/cron/gcal-renew-watch
 *
 * Daily job that re-registers Google Calendar push channels nearing
 * expiry (≤ 24h remaining). Channels are valid for at most 7 days.
 *
 * Auth: `x-cron-secret` constant-time check.
 *
 * Cloud Scheduler config:
 *   schedule: every 6 hours
 *   target:   HTTPS GET to this URL
 *
 * Idempotent: re-running before expiry is a no-op because we filter on
 * `expirationMs - now < 24h`.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyCronSecret } from "@/lib/server/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { encrypt, randomToken } from "@/lib/server/crypto";
import { stopWatch, watchCalendar, type IntegrationDoc } from "@/lib/server/google-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

const RENEW_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest): Promise<Response> {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const webhook = process.env.GOOGLE_WEBHOOK_URL;
  if (!webhook) {
    return NextResponse.json({ error: "GOOGLE_WEBHOOK_URL not configured" }, { status: 500 });
  }

  const fs = getAdminFirestore();
  const now = Date.now();

  const connected = await fs.collectionGroup("integrations")
    .where("status", "==", "connected")
    .get();

  let renewed = 0;
  let skipped = 0;
  let failed  = 0;

  for (const doc of connected.docs) {
    if (doc.id !== "google") continue;
    const data = doc.data() as IntegrationDoc;
    const channel = data.pushChannel;
    if (channel && channel.expirationMs - now > RENEW_WINDOW_MS) {
      skipped++;
      continue;
    }
    const uid = doc.ref.path.split("/")[1];
    try {
      if (channel) {
        try { await stopWatch({ uid, channelId: channel.id, resourceId: channel.resourceId }); } catch {/* ignore */}
      }
      const token = randomToken(24);
      const result = await watchCalendar({ uid, webhookUrl: webhook, channelToken: token });
      await doc.ref.set({
        pushChannel: {
          id: result.channelId,
          resourceId: result.resourceId,
          expirationMs: result.expirationMs,
          tokenEncrypted: encrypt(token),
        },
      } as Partial<IntegrationDoc>, { merge: true });
      renewed++;
    } catch {
      failed++;
    }
  }

  return NextResponse.json({ ok: true, renewed, skipped, failed, scannedAt: now });
}
