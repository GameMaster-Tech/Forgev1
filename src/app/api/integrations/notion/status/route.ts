/**
 * GET /api/integrations/notion/status
 *
 * Returns the current Notion-integration state for the calling user.
 * Drives the connect/disconnect/sync UI on /settings. Never returns
 * the encrypted token — only the redacted account + stats + status.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { notionConfigured } from "@/lib/server/notion-api";
import type { NotionIntegrationDoc } from "@/lib/integrations/notion/types";

export async function GET(req: NextRequest): Promise<Response> {
  const user = await verifyRequest(req);
  if (!user) {
    return NextResponse.json({ status: "disconnected", configured: notionConfigured() }, { status: 200 });
  }
  try {
    const fs = getAdminFirestore();
    const snap = await fs.doc(`users/${user.uid}/integrations/notion`).get();
    if (!snap.exists) {
      return NextResponse.json({
        status: "disconnected",
        configured: notionConfigured(),
      });
    }
    const doc = snap.data() as NotionIntegrationDoc;
    return NextResponse.json({
      status: doc.status,
      account: doc.account ?? null,
      connectedAt: doc.connectedAt ?? null,
      lastSyncedAt: doc.lastSyncedAt ?? null,
      stats: doc.stats ?? null,
      lastError: doc.lastError ?? null,
      configured: notionConfigured(),
    });
  } catch {
    return NextResponse.json({
      status: "disconnected",
      configured: notionConfigured(),
    });
  }
}
