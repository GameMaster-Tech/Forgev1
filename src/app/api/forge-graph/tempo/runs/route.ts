/**
 * GET /api/forge-graph/tempo/runs?projectId=…
 *
 * Returns the persisted Tempo run history for the active project. The
 * actual collection read still goes through Firestore rules (the
 * `forge_tempo_runs` rule requires `ownerId == request.auth.uid`), so
 * this route is a thin orchestration layer that calls the SDK on
 * behalf of the client and reuses the existing auth + rate-limit
 * surface.
 *
 * Why server-side: the runs page calls this once on mount, the data
 * is small enough to JSON-stream, and routing the read through the
 * server keeps the client bundle lean.
 */

import { NextResponse, type NextRequest } from "next/server";
import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_READ,
} from "@/lib/server/rate-limit";
import { getAdminFirestore } from "@/lib/firebase/admin";
import type { TempoRunReport } from "@/lib/forge-graph/tempo-advanced";

export async function GET(req: NextRequest): Promise<Response> {
  const auth = await requireUser(req);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    req,
    { routeId: "forge-graph.tempo.runs", ...RATE_LIMIT_READ },
    identifyClient(req, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return NextResponse.json({ error: "projectId is required" }, { status: 400 });
  }

  try {
    const fs = getAdminFirestore();
    const snap = await fs
      .collection("forge_tempo_runs")
      .where("ownerId", "==", auth.uid)
      .where("projectId", "==", projectId)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const runs = snap.docs.map((d) => {
      const data = d.data() as {
        projectId: string;
        snapshotId: string;
        scenario: string;
        report: TempoRunReport;
        acceptedBy: string;
        createdAt?: { toMillis?: () => number } | null;
      };
      return {
        id: d.id,
        projectId: data.projectId,
        snapshotId: data.snapshotId,
        scenario: data.scenario,
        report: data.report,
        acceptedBy: data.acceptedBy,
        createdAt: data.createdAt?.toMillis?.() ?? Date.now(),
      };
    });

    return NextResponse.json({ runs });
  } catch (err) {
    console.error("[forge-graph.tempo.runs] read failed", err);
    return NextResponse.json(
      { error: "Failed to read run history" },
      { status: 500 },
    );
  }
}
