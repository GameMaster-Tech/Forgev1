/**
 * POST /api/research — proxies the EXA search/answer API.
 *
 * Security posture:
 *   • requireUser — Firebase ID token in `Authorization: Bearer …`
 *   • enforceRateLimit — EXPENSIVE preset (20 req/min/user) — EXA is metered
 *   • Input validation — `query` must be a non-empty string ≤ 1000 chars,
 *     `mode` must be one of the documented enums.
 *   • Output is filtered to a fixed projection — we never echo raw upstream
 *     responses to the client.
 *   • Errors are scrubbed before returning; full stack traces stay in the
 *     server log only.
 */

import Exa from "exa-js";
import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";

const exa = new Exa(process.env.EXA_API_KEY!);

const MODES = new Set(["search", "answer", "synthesis"] as const);
const MAX_QUERY_LEN = 1000;

export async function POST(request: Request) {
  // 1. Auth — token presence + signature + revocation check.
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  // 2. Per-user rate-limit on a metered upstream.
  const rl = enforceRateLimit(
    request,
    { routeId: "research", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  try {
    const body = (await request.json()) as { query?: unknown; mode?: unknown };
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const mode = typeof body.mode === "string" ? body.mode : "search";

    // 3. Input validation — fail closed on garbage.
    if (!query) {
      return Response.json({ error: "Query is required" }, { status: 400 });
    }
    if (query.length > MAX_QUERY_LEN) {
      return Response.json(
        { error: `Query too long (max ${MAX_QUERY_LEN} chars)` },
        { status: 400 },
      );
    }
    if (!MODES.has(mode as "search" | "answer" | "synthesis")) {
      return Response.json({ error: "Invalid mode" }, { status: 400 });
    }

    if (mode === "answer" || mode === "synthesis") {
      const response = await exa.answer(query, { text: true, model: "exa" });
      return Response.json({
        type: "answer",
        answer: response.answer as string,
        citations: response.citations.map((c) => ({
          title: c.title,
          url: c.url,
          text: (c as Record<string, unknown>).text ?? null,
          publishedDate: c.publishedDate,
          author: c.author,
        })),
      });
    }

    const results = await exa.search(query, {
      type: "auto",
      numResults: 5,
      useAutoprompt: true,
    });
    return Response.json({
      type: "search",
      results: results.results.map((r) => ({
        title: r.title,
        url: r.url,
        publishedDate: r.publishedDate,
      })),
    });
  } catch (error) {
    // Server log keeps the full error; client gets a generic message. We log
    // a redacted shape — never the raw error object which could carry headers
    // or request bodies with secrets in them.
    console.error("[research] upstream failure", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({ error: "Research query failed" }, { status: 500 });
  }
}
