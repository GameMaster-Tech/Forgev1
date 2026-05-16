/**
 * POST /api/pulse/refactor/reject
 *
 * Mark a Pulse refactor proposal as user-declined. Pulse will NOT
 * re-propose the same (blockId, triggerSet) combination for 7 days.
 *
 * Request body:
 *   {
 *     projectId: string;
 *     blockId: string;
 *     documentId: string;
 *     triggeredBy: string[];   // assertion ids that fired the proposal
 *   }
 *
 * Response (success):
 *   { ok: true, rejectedKey, expiresAt: ISO }
 *
 * Auth: requires a verified Firebase user. Writes to
 *   users/{uid}/projects/{projectId}/refactorRejections/{rejectedKey}
 * via the Admin SDK. Each rejection has a `ttlExpiresAt` field so
 * Firestore TTL policies can sweep stale entries automatically.
 */

import { NextRequest, NextResponse } from "next/server";
import { verifyRequest } from "@/lib/server/auth";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { REJECTION_TTL_MS, rejectionKey } from "@/lib/pulse/rejection";

interface RejectBody {
  projectId?: string;
  blockId?: string;
  documentId?: string;
  triggeredBy?: string[];
}

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let payload: RejectBody;
  try {
    payload = (await req.json()) as RejectBody;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const { projectId, blockId, documentId, triggeredBy = [] } = payload;
  if (!projectId || !blockId || !documentId || !Array.isArray(triggeredBy)) {
    return NextResponse.json({ error: "missing fields" }, { status: 400 });
  }

  const now = Date.now();
  const expiresAt = now + REJECTION_TTL_MS;
  const key = rejectionKey(blockId, triggeredBy);

  try {
    const fs = getAdminFirestore();
    const ref = fs
      .collection("users")
      .doc(user.uid)
      .collection("projects")
      .doc(projectId)
      .collection("refactorRejections")
      .doc(key);

    await ref.set(
      {
        blockId,
        documentId,
        triggeredBy,
        rejectedAt: new Date(now).toISOString(),
        expiresAt: new Date(expiresAt).toISOString(),
        ttlExpiresAt: new Date(expiresAt),
      },
      { merge: true },
    );

    return NextResponse.json({
      ok: true,
      rejectedKey: key,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  } catch (err) {
    console.error("[pulse.refactor.reject] persist failed:", err);
    return NextResponse.json({ error: "persist failed" }, { status: 500 });
  }
}
