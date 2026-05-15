/**
 * POST /api/integrations/google/webhook
 *
 * Receives push notifications from Google Calendar's watch API. Google
 * POSTs an empty body with these headers:
 *
 *   X-Goog-Channel-Id         our channelId
 *   X-Goog-Channel-Token      the token we supplied at watch time
 *   X-Goog-Resource-Id        watched resource id
 *   X-Goog-Resource-State     "sync" | "exists" | "not_exists"
 *   X-Goog-Message-Number     monotonic message id
 *
 * On any state other than `sync` (the initial probe), we kick off an
 * async sync for the user that owns this channelId. We do NOT block
 * the response — Google retries on non-2xx, so we acknowledge fast and
 * fire-and-forget the sync.
 *
 * Token verification protects against forged callbacks: we look up the
 * channel record and constant-time compare the supplied token to the
 * encrypted token on file.
 */

import { NextResponse, type NextRequest } from "next/server";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { decrypt } from "@/lib/server/crypto";
import { runBidirectionalSync } from "@/app/api/integrations/google/sync/route";
import { publishCalendarEvent } from "@/lib/server/realtime";
import type { IntegrationDoc } from "@/lib/server/google-api";

export async function POST(req: NextRequest): Promise<Response> {
  const channelId = req.headers.get("x-goog-channel-id");
  const channelToken = req.headers.get("x-goog-channel-token") ?? "";
  const state = req.headers.get("x-goog-resource-state");
  if (!channelId) return NextResponse.json({ ok: true });
  if (state === "sync") {
    // Initial probe — nothing to do, just 2xx.
    return NextResponse.json({ ok: true });
  }
  // Find the user owning this channel.
  const fs = getAdminFirestore();
  // Collection group query so we can look up by channel id across all users.
  const matches = await fs.collectionGroup("integrations")
    .where("pushChannel.id", "==", channelId)
    .limit(1)
    .get();
  if (matches.empty) return NextResponse.json({ ok: true }); // unknown channel, drop quietly
  const doc = matches.docs[0];
  const data = doc.data() as IntegrationDoc;
  const expectedToken = data.pushChannel?.tokenEncrypted ? safeDecrypt(data.pushChannel.tokenEncrypted) : "";
  if (!constantEq(channelToken, expectedToken)) {
    return NextResponse.json({ ok: false, error: "bad token" }, { status: 401 });
  }
  // Owning uid: /users/{uid}/integrations/google
  const uidSegment = doc.ref.path.split("/")[1];
  // Fire-and-forget. Use a small range so the sync is cheap.
  const now = Date.now();
  void (async () => {
    try {
      await runBidirectionalSync({
        uid: uidSegment,
        rangeStart: new Date(now - 2 * 86_400_000).toISOString(),
        rangeEnd:   new Date(now + 30 * 86_400_000).toISOString(),
        policy: "prefer-newer",
      });
      await publishCalendarEvent(uidSegment, { kind: "sync.complete", at: Date.now() });
    } catch (err) {
      await publishCalendarEvent(uidSegment, { kind: "sync.error", at: Date.now(), message: err instanceof Error ? err.message : "webhook sync failed" });
    }
  })();
  return NextResponse.json({ ok: true });
}

function constantEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function safeDecrypt(blob: { v: "v1"; iv: string; tag: string; ct: string }): string {
  try { return decrypt(blob); } catch { return ""; }
}
