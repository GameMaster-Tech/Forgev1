/**
 * POST /api/share/mint
 *
 * Mints a public share token for one of the caller's documents. Returns
 * the share URL the client copies to the user's clipboard.
 *
 * Body:
 *   { documentId: string, expiresInDays?: number }
 *
 * Security model:
 *   • requireUser — Firebase ID token
 *   • The route uses the Admin SDK to look up the document and verify
 *     the caller owns it before minting. Clients can NOT write to
 *     `/publicLinks` directly — the rule only allows admin-SDK writes.
 *   • Tokens are 24-byte URL-safe random — unguessable.
 *   • Each token records: documentId, projectId (denormalised),
 *     createdBy (uid), createdAt, expiresAt, revoked: false.
 *   • The /share/[token] page reads through the same rule (public
 *     read) but the API filters out revoked / expired tokens server-
 *     side before rendering.
 */

import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_MODERATE,
} from "@/lib/server/rate-limit";
import { getAdminFirestore } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";

const DEFAULT_EXPIRES_DAYS = 30;
const MAX_EXPIRES_DAYS = 365;

function newToken(): string {
  return randomBytes(24).toString("base64url");
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    req,
    { routeId: "share.mint", ...RATE_LIMIT_MODERATE },
    identifyClient(req, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  let body: { documentId?: unknown; expiresInDays?: unknown };
  try {
    body = (await req.json()) as { documentId?: unknown; expiresInDays?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const documentId =
    typeof body.documentId === "string" ? body.documentId.trim() : "";
  if (!documentId) {
    return NextResponse.json({ error: "documentId is required" }, { status: 400 });
  }
  const expiresInDays = Math.min(
    Math.max(1, Math.round(Number(body.expiresInDays ?? DEFAULT_EXPIRES_DAYS))),
    MAX_EXPIRES_DAYS,
  );

  try {
    const fs = getAdminFirestore();
    const docSnap = await fs.doc(`documents/${documentId}`).get();
    if (!docSnap.exists) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    const docData = docSnap.data() as { userId: string; projectId: string };
    if (docData.userId !== auth.uid) {
      return NextResponse.json({ error: "Not your document" }, { status: 403 });
    }

    // Idempotency: if the caller already has an active token for this
    // doc, return that one instead of churning a new row. Saves the
    // user from a "I clicked twice" multiplication of links.
    const existingSnap = await fs
      .collection("publicLinks")
      .where("documentId", "==", documentId)
      .where("createdBy", "==", auth.uid)
      .where("revoked", "==", false)
      .limit(1)
      .get();
    const now = Date.now();
    if (!existingSnap.empty) {
      const existing = existingSnap.docs[0];
      const existingData = existing.data() as { expiresAt?: number };
      if (
        typeof existingData.expiresAt === "number" &&
        existingData.expiresAt > now
      ) {
        return NextResponse.json({
          token: existing.id,
          url: `/share/${existing.id}`,
          expiresAt: existingData.expiresAt,
          reused: true,
        });
      }
    }

    const token = newToken();
    const expiresAt = now + expiresInDays * 86_400_000;
    await fs.collection("publicLinks").doc(token).set({
      documentId,
      projectId: docData.projectId,
      createdBy: auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
      revoked: false,
    });
    return NextResponse.json({
      token,
      url: `/share/${token}`,
      expiresAt,
      reused: false,
    });
  } catch (err) {
    console.error("[share.mint] failed", err);
    return NextResponse.json(
      { error: "Failed to mint share link" },
      { status: 500 },
    );
  }
}
