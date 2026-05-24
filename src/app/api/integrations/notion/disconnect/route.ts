/**
 * POST /api/integrations/notion/disconnect
 *
 * Revoke the token upstream and flip the local integration doc to
 * `disconnected`. Idempotent — failing to reach Notion still clears
 * the local state. Synced documents stay in Forge (the user owns them
 * now); only the link to Notion is cut.
 */

import { NextResponse, type NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/auth";
import { disconnectNotion } from "@/lib/server/notion-api";

export async function POST(req: NextRequest): Promise<Response> {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  await disconnectNotion(user.uid);
  return NextResponse.json({ ok: true });
}
