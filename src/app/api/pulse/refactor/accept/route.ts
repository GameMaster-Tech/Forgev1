/**
 * POST /api/pulse/refactor/accept
 *
 * Accept a Pulse refactor proposal. Body is persisted back to the
 * referenced ContentBlock so future renders use the rewritten text.
 *
 * Request body:
 *   {
 *     projectId: string;
 *     blockId: string;
 *     documentId: string;
 *     body: string;
 *     triggeredBy: string[];   // assertion ids
 *     kind: "value-swap" | "text-rewrite";
 *   }
 *
 * Response (success):
 *   { ok: true, blockId, savedAt: ISO }
 *
 * Auth: requires a verified Firebase user. Writes to
 *   users/{uid}/projects/{projectId}/blocks/{blockId}
 * via the Admin SDK.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyRequest } from "@/lib/server/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_MODERATE,
} from "@/lib/server/rate-limit";

interface AcceptBody {
  projectId?: string;
  blockId?: string;
  documentId?: string;
  body?: string;
  triggeredBy?: string[];
  kind?: "value-swap" | "text-rewrite";
}

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const rl = enforceRateLimit(
    req,
    { routeId: "pulse.refactor.accept", ...RATE_LIMIT_MODERATE },
    identifyClient(req, user.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  let payload: AcceptBody;
  try {
    payload = (await req.json()) as AcceptBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { projectId, blockId, documentId, body, triggeredBy = [], kind = "value-swap" } = payload;
  if (!projectId || !blockId || !documentId || typeof body !== "string") {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }
  if (body.length > 200_000) {
    return NextResponse.json({ error: "body too large" }, { status: 413 });
  }

  const now = new Date().toISOString();
  try {
    const fs = getAdminFirestore();
    const blockRef = fs
      .collection("users")
      .doc(user.uid)
      .collection("projects")
      .doc(projectId)
      .collection("blocks")
      .doc(blockId);

    await blockRef.set(
      {
        documentId,
        body,
        lastRefactorAcceptedAt: now,
        lastRefactorKind: kind,
        lastRefactorTriggeredBy: triggeredBy,
        updatedAt: now,
      },
      { merge: true },
    );

    return NextResponse.json({ ok: true, blockId, savedAt: now });
  } catch (err) {
    console.error("[pulse.refactor.accept] persist failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json({ error: "persist failed" }, { status: 500 });
  }
}
