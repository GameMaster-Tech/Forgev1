/**
 * POST /api/verify-citation — Crossref lookup for a title/author pair.
 *
 * Security posture:
 *   • requireUser — Firebase ID token
 *   • enforceRateLimit — MODERATE preset (Crossref is rate-limited politely
 *     by convention; we cap it ourselves to avoid getting our `mailto` ban-
 *     listed).
 *   • Input validation: title required, both fields bounded.
 *   • The Crossref URL is built from an env override but we hard-pin the
 *     host to api.crossref.org so a malicious env can't redirect lookups
 *     to an attacker-controlled origin.
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_MODERATE,
} from "@/lib/server/rate-limit";

const DEFAULT_CROSSREF_URL = "https://api.crossref.org/works";
const ALLOWED_HOSTS = new Set(["api.crossref.org"]);
const MAX_FIELD_LEN = 500;

function resolveCrossrefUrl(): string {
  const raw = process.env.CROSSREF_API_URL || DEFAULT_CROSSREF_URL;
  try {
    const url = new URL(raw);
    if (!ALLOWED_HOSTS.has(url.hostname)) {
      // Fall back to the default — defence against env tampering.
      return DEFAULT_CROSSREF_URL;
    }
    return raw;
  } catch {
    return DEFAULT_CROSSREF_URL;
  }
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "verify-citation", ...RATE_LIMIT_MODERATE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  try {
    const body = (await request.json()) as { title?: unknown; author?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const author = typeof body.author === "string" ? body.author.trim() : "";

    if (!title) {
      return Response.json({ error: "Title is required" }, { status: 400 });
    }
    if (title.length > MAX_FIELD_LEN || author.length > MAX_FIELD_LEN) {
      return Response.json(
        { error: `Fields capped at ${MAX_FIELD_LEN} chars` },
        { status: 400 },
      );
    }

    const queryParts = [`query.title=${encodeURIComponent(title)}`];
    if (author) queryParts.push(`query.author=${encodeURIComponent(author)}`);
    queryParts.push("rows=1");
    queryParts.push("mailto=research@forgeresearch.ai");

    const url = `${resolveCrossrefUrl()}?${queryParts.join("&")}`;
    const res = await fetch(url);

    if (!res.ok) {
      return Response.json({ error: "Crossref lookup failed" }, { status: 502 });
    }

    const data = await res.json();
    const items = data.message?.items;

    if (!items || items.length === 0) {
      return Response.json({
        verified: false,
        message: "No matching publication found in Crossref",
      });
    }

    const match = items[0];
    const doi = match.DOI;
    const matchTitle = match.title?.[0] || "";
    const matchAuthors = (match.author || [])
      .map(
        (a: { given?: string; family?: string }) =>
          `${a.given || ""} ${a.family || ""}`.trim(),
      )
      .join(", ");
    const journal = match["container-title"]?.[0] || "";
    const year =
      match.published?.["date-parts"]?.[0]?.[0] ||
      match.created?.["date-parts"]?.[0]?.[0] ||
      null;

    return Response.json({
      verified: true,
      doi,
      title: matchTitle,
      authors: matchAuthors,
      journal,
      year,
      url: `https://doi.org/${doi}`,
    });
  } catch (error) {
    console.error("[verify-citation] upstream failure", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({ error: "Citation verification failed" }, { status: 500 });
  }
}
