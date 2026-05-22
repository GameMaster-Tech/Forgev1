/**
 * POST /api/forge-graph/tempo/sign
 *
 * Issues a Tempo execution token for an accepted VisualDeltaMap. The
 * client confirms the proposed scenario in the UI, asks the server to
 * sign it, then submits the signed token to `/apply` to actually run
 * the Tempo pipeline. Signing requires auth + rate limit; verifying
 * (in `/apply`) re-checks both.
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_MODERATE,
} from "@/lib/server/rate-limit";
import { hashDeltaMutations, issueTempoToken } from "@/lib/forge-graph/tempo-token";

interface IncomingMutation {
  nodeId?: unknown;
  targetField?: unknown;
  proposedValue?: unknown;
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "forge-graph.tempo.sign", ...RATE_LIMIT_MODERATE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  let body: { projectId?: unknown; mutations?: unknown };
  try {
    body = (await request.json()) as { projectId?: unknown; mutations?: unknown };
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  if (!projectId) {
    return Response.json({ error: "projectId is required" }, { status: 400 });
  }
  if (!Array.isArray(body.mutations)) {
    return Response.json({ error: "mutations array is required" }, { status: 400 });
  }

  const sanitised: Array<{ nodeId: string; targetField: string; proposedValue: unknown }> = [];
  for (const m of body.mutations as IncomingMutation[]) {
    if (typeof m.nodeId !== "string" || typeof m.targetField !== "string") {
      return Response.json({ error: "malformed mutation entry" }, { status: 400 });
    }
    sanitised.push({
      nodeId: m.nodeId,
      targetField: m.targetField,
      proposedValue: m.proposedValue,
    });
  }

  try {
    const deltaHash = hashDeltaMutations(sanitised);
    const issued = issueTempoToken({ uid: auth.uid, projectId, deltaHash });
    return Response.json({
      token: issued.token,
      expiresAt: issued.payload.exp,
      deltaHash,
    });
  } catch (err) {
    console.error("[forge-graph.tempo.sign]", err);
    return Response.json(
      { error: "Failed to issue execution token" },
      { status: 500 },
    );
  }
}
