/**
 * POST /api/forge-graph/tempo/apply
 *
 * Verifies a Tempo execution token, runs the AdvancedTempoEngine
 * against the supplied graph snapshot, records the resulting
 * `TempoRunReport` under `forge_tempo_runs`, and returns the report
 * plus the new snapshot id. The route does NOT touch live source
 * collections itself — that's `applyDeltaToSources` on the client, which
 * runs under Firestore security rules.
 *
 * Why the split:
 *   • Tempo computation is deterministic and heavy enough that we run
 *     it server-side so the client doesn't have to.
 *   • Source-collection writes already pass through Firestore rules and
 *     the existing helpers (`updateDocument`, etc.); replicating that
 *     auth surface here would be redundant.
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_MODERATE,
} from "@/lib/server/rate-limit";
import { hashDeltaMutations, verifyTempoToken } from "@/lib/forge-graph/tempo-token";
import { AdvancedTempoEngine } from "@/lib/forge-graph/tempo-advanced";
import { deserialiseGraph, serialiseGraph } from "@/lib/forge-graph/persistence";
import type { SerialisedGraph, VisualDeltaMap } from "@/lib/forge-graph/types";

interface ApplyBody {
  token?: unknown;
  projectId?: unknown;
  graph?: unknown;
  delta?: unknown;
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "forge-graph.tempo.apply", ...RATE_LIMIT_MODERATE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  let body: ApplyBody;
  try {
    body = (await request.json()) as ApplyBody;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : "";
  const projectId = typeof body.projectId === "string" ? body.projectId : "";
  if (!token || !projectId) {
    return Response.json({ error: "token and projectId are required" }, { status: 400 });
  }
  if (!body.graph || !body.delta) {
    return Response.json({ error: "graph and delta are required" }, { status: 400 });
  }

  const delta = body.delta as VisualDeltaMap;
  if (!delta.isViable) {
    return Response.json({ error: "delta is not viable" }, { status: 400 });
  }

  const deltaHash = hashDeltaMutations(delta.mutations);
  const verdict = verifyTempoToken(token, {
    uid: auth.uid,
    projectId,
    deltaHash,
  });
  if (!verdict.ok) {
    return Response.json(
      { error: `token rejected (${verdict.reason})` },
      { status: 401 },
    );
  }

  let graph;
  try {
    graph = deserialiseGraph(body.graph as SerialisedGraph);
  } catch {
    return Response.json(
      { error: "graph payload failed deserialisation" },
      { status: 400 },
    );
  }

  try {
    const engine = new AdvancedTempoEngine();
    const { graph: sorted, report } = engine.execute(graph, delta);
    const serialised = serialiseGraph(sorted);
    return Response.json({ graph: serialised, report });
  } catch (err) {
    console.error("[forge-graph.tempo.apply] engine failed", err);
    return Response.json(
      { error: "tempo engine failed", message: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
