/**
 * POST /api/ai/reactor — the recompute engine behind Reactors.
 *
 * A Reactor is content *derived* from other content by a natural-language
 * rule (see src/lib/reactive/types.ts). The client resolves the Reactor's
 * sources to text and posts them with the rule; this endpoint returns the
 * derived content as a clean HTML fragment, ready to render in the editor.
 * It re-runs whenever the sources drift — that reactivity is the feature.
 *
 * Stateless by design: the client owns source resolution and persistence;
 * this route only does the synthesis. Mirrors the security posture of the
 * other AI routes (requireUser + rate limit + bounded inputs).
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";
import { DEFAULT_MODEL, groqChat } from "@/lib/ai/groq";

const MAX_RULE_CHARS = 400;
const MAX_SOURCE_CHARS = 6_000; // per source
const MAX_TOTAL_CHARS = 24_000; // across all sources
const MAX_SOURCES = 12;

const SYSTEM_PROMPT = `You are the recompute engine inside Forge, an AI-native reactive workspace. A "Reactor" is a block of content the user has defined by a RULE over one or more SOURCES. Your job: produce the derived content the rule asks for, computed only from the SOURCES.

Output contract:
- Return ONLY an HTML fragment of the derived content. No commentary, no preamble, no markdown code fences.
- Use ONLY these tags: <p> <h2> <h3> <ul> <ol> <li> <strong> <em> <a> <blockquote> <code> <br>. No <table>, <h1>, <script>, or <style>.
- Derive strictly from the SOURCES. Never invent facts, numbers, names, or citations not present in them.
- Honour the rule's requested SHAPE: "summary" → tight prose/bullets; "open questions"/"action items"/"list" → a <ul>/<ol>; "the value of X" → just that value.
- If the sources contain nothing relevant to the rule, return "<p><em>Nothing in the sources matches this rule yet.</em></p>".
- Be faithful and concise. This text is recomputed automatically when the sources change, so keep it derivable, not editorialised.`;

interface SourceIn {
  label?: unknown;
  text?: unknown;
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "ai.reactor", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  try {
    const body = (await request.json()) as { rule?: unknown; sources?: unknown };

    const rule = typeof body.rule === "string" ? body.rule.trim() : "";
    if (!rule) {
      return Response.json({ error: "rule is required" }, { status: 400 });
    }
    if (rule.length > MAX_RULE_CHARS) {
      return Response.json(
        { error: `rule too long (max ${MAX_RULE_CHARS} chars)` },
        { status: 400 },
      );
    }

    const rawSources = Array.isArray(body.sources) ? (body.sources as SourceIn[]) : [];
    const sources = rawSources
      .slice(0, MAX_SOURCES)
      .map((s) => ({
        label: typeof s.label === "string" ? s.label.slice(0, 200) : "Source",
        text: typeof s.text === "string" ? s.text.slice(0, MAX_SOURCE_CHARS) : "",
      }))
      .filter((s) => s.text.trim().length > 0);

    if (sources.length === 0) {
      // No usable source content — return the engine's "empty" sentinel
      // rather than an error so the client can render it directly.
      return Response.json({
        result: "<p><em>Nothing in the sources matches this rule yet.</em></p>",
      });
    }

    let total = 0;
    const parts: string[] = [];
    for (const s of sources) {
      if (total >= MAX_TOTAL_CHARS) break;
      const slice = s.text.slice(0, MAX_TOTAL_CHARS - total);
      total += slice.length;
      parts.push(`### SOURCE: ${s.label}\n${slice}`);
    }

    const userPrompt = `RULE:\n${rule}\n\nSOURCES:\n${parts.join("\n\n")}`;

    const result = await groqChat({
      model: DEFAULT_MODEL,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 1400,
      temperature: 0.3,
    });

    let html = (result.content ?? "").trim();
    const fence = /^```(?:html)?\s*([\s\S]*?)\s*```$/i.exec(html);
    if (fence) html = fence[1].trim();
    if (!html) {
      return Response.json({ error: "Empty recompute" }, { status: 502 });
    }

    return Response.json({ result: html });
  } catch (error) {
    console.error("[ai.reactor] upstream failure", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({ error: "Recompute failed" }, { status: 500 });
  }
}
