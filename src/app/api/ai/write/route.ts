/**
 * POST /api/ai/write — Groq-backed writing assistant (Llama 3.3 70B).
 *
 * Security posture:
 *   • requireUser — Firebase ID token
 *   • enforceRateLimit — EXPENSIVE preset (Groq is metered)
 *   • Strict input validation: `command` is a closed enum, `text` and
 *     `context` are bounded.
 *   • Output is the model's text response only — no metadata, no
 *     usage counts, no raw model object.
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";
import { DEFAULT_MODEL, groqChat } from "@/lib/ai/groq";

type AICommand =
  | "continue"
  | "summarize"
  | "expand"
  | "simplify"
  | "fix-grammar"
  | "make-concise"
  | "rewrite-formal"
  | "rewrite-casual";

const VALID_COMMANDS = new Set<AICommand>([
  "continue",
  "summarize",
  "expand",
  "simplify",
  "fix-grammar",
  "make-concise",
  "rewrite-formal",
  "rewrite-casual",
]);

const MAX_TEXT_CHARS = 12_000;
const MAX_CONTEXT_CHARS = 16_000;

const systemPrompt = `You are a writing assistant embedded in Forge, an AI research workspace. You help researchers write, edit, and refine their documents.

Rules:
- Return ONLY the generated/edited text, no explanations or meta-commentary
- Match the tone and style of the surrounding context
- Preserve any citations or references
- Keep academic rigor when the content is scholarly
- Output clean prose, no markdown headers unless continuing a section that uses them`;

const commandPrompts: Record<AICommand, (text: string, context: string) => string> = {
  continue: (text, context) =>
    `Continue writing from where this text left off. Match the style and flow.\n\nDocument context:\n${context}\n\nContinue from:\n${text}`,
  summarize: (text) =>
    `Summarize the following text concisely while preserving key points and citations:\n\n${text}`,
  expand: (text) =>
    `Expand on the following text with more detail, examples, or supporting points:\n\n${text}`,
  simplify: (text) =>
    `Rewrite the following text in simpler, clearer language while preserving the meaning:\n\n${text}`,
  "fix-grammar": (text) =>
    `Fix any grammar, spelling, or punctuation errors in the following text. Return the corrected version:\n\n${text}`,
  "make-concise": (text) =>
    `Make the following text more concise. Remove redundancy and tighten the prose:\n\n${text}`,
  "rewrite-formal": (text) =>
    `Rewrite the following text in a more formal, academic tone:\n\n${text}`,
  "rewrite-casual": (text) =>
    `Rewrite the following text in a more conversational, accessible tone:\n\n${text}`,
};

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "ai.write", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  try {
    const body = (await request.json()) as {
      command?: unknown;
      text?: unknown;
      context?: unknown;
    };
    const command = typeof body.command === "string" ? (body.command as AICommand) : null;
    const text = typeof body.text === "string" ? body.text : "";
    const context = typeof body.context === "string" ? body.context : "";

    if (!command || !text) {
      return Response.json({ error: "Command and text are required" }, { status: 400 });
    }
    if (!VALID_COMMANDS.has(command)) {
      return Response.json({ error: "Invalid command" }, { status: 400 });
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

    const userPrompt = commandPrompts[command](text, context);
    const result = await groqChat({
      model: DEFAULT_MODEL,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 1024,
      temperature: 0.5,
    });

    return Response.json({ result: result.content });
  } catch (error) {
    console.error("[ai.write] upstream failure", {
      message: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({ error: "AI generation failed" }, { status: 500 });
  }
}
