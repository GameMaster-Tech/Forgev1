/**
 * POST /api/ai/transform — Morph: content-agnostic, natural-language
 * transforms for the AI-native workspace.
 *
 * Unlike /api/ai/write (a closed enum of 8 research-flavoured writing
 * commands), this endpoint takes a *free-form instruction* and reshapes
 * any content — a meeting note, a spec, a list, a poem — into whatever
 * the user asked for. It returns a clean HTML fragment so structural
 * transforms ("make this a table", "turn this into a checklist") render
 * as real editor nodes, not literal markdown text.
 *
 * Security posture mirrors /api/ai/write:
 *   • requireUser (Firebase ID token)
 *   • enforceRateLimit (EXPENSIVE — Groq is metered)
 *   • instruction / text / context are bounded
 *   • response is the transformed HTML only — no metadata
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";
import { DEFAULT_MODEL, FAST_MODEL, groqChat } from "@/lib/ai/groq";

const MAX_INSTRUCTION_CHARS = 600;
const MAX_TEXT_CHARS = 12_000;
const MAX_CONTEXT_CHARS = 16_000;

const SYSTEM_PROMPT = `You are Morph, the transform engine inside Forge — a general AI-native workspace for notes, plans, specs, journals, and any kind of thinking. The user selects some content and tells you, in plain language, how to reshape it. You apply that instruction faithfully.

Output contract:
- Return ONLY an HTML fragment representing the transformed content. No commentary, no explanations, no markdown code fences.
- Use ONLY these tags: <p> <h1> <h2> <h3> <ul> <ol> <li> <strong> <em> <u> <s> <a> <blockquote> <code> <pre> <hr> <br>.
- Honour the requested STRUCTURE: for a checklist or list use <ul>/<ol> with one <li> per item; for headings use <h1>-<h3>; for steps use an <ol>.
- Rich tables are NOT supported by this editor — if asked for a table, return a tidy <ul> where each <li> packs the row's fields (e.g. "<strong>Name</strong>: value · field: value"). Never emit <table>.
- Preserve the user's voice and meaning. Preserve links, numbers, names, and any citations verbatim — never invent facts, sources, or statistics.
- Transform only what was given. Do not pad, do not add a preamble or a closing remark, do not editorialise.
- If the instruction is a pure rewrite (tone/length/clarity), keep comparable length unless asked to expand or shorten.
- Plain prose with no requested structure should come back as one or more <p> elements.`;

/** Strip a stray ```html … ``` fence if the model adds one despite the prompt. */
function stripFences(s: string): string {
  const t = s.trim();
  const fence = /^```(?:html)?\s*([\s\S]*?)\s*```$/i.exec(t);
  return (fence ? fence[1] : t).trim();
}

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "ai.transform", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  try {
    const body = (await request.json()) as {
      instruction?: unknown;
      text?: unknown;
      context?: unknown;
      mode?: unknown;
    };

    const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
    const text = typeof body.text === "string" ? body.text : "";
    const context = typeof body.context === "string" ? body.context : "";
    const mode = body.mode === "fast" ? "fast" : "quality";

    if (!instruction || !text.trim()) {
      return Response.json(
        { error: "instruction and text are required" },
        { status: 400 },
      );
    }
    if (instruction.length > MAX_INSTRUCTION_CHARS) {
      return Response.json(
        { error: `instruction too long (max ${MAX_INSTRUCTION_CHARS} chars)` },
        { status: 400 },
      );
    }
    if (text.length > MAX_TEXT_CHARS) {
      return Response.json(
        { error: `text too long (max ${MAX_TEXT_CHARS} chars)` },
        { status: 400 },
      );
    }
    if (context.length > MAX_CONTEXT_CHARS) {
      return Response.json(
        { error: `context too long (max ${MAX_CONTEXT_CHARS} chars)` },
        { status: 400 },
      );
    }

    const userPrompt = [
      context.trim()
        ? `Surrounding document (for tone/context only — do NOT transform this part):\n${context.trim()}\n`
        : "",
      `Instruction:\n${instruction}\n`,
      `Content to transform:\n${text}`,
    ]
      .filter(Boolean)
      .join("\n");

    const result = await groqChat({
      model: mode === "fast" ? FAST_MODEL : DEFAULT_MODEL,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 1600,
      temperature: 0.4,
    });

    const html = stripFences(result.content ?? "");
    if (!html) {
      return Response.json({ error: "Empty transform" }, { status: 502 });
    }
    return Response.json({ result: html });
  } catch (error) {
    console.error("[ai.transform] upstream failure", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({ error: "Transform failed" }, { status: 500 });
  }
}
