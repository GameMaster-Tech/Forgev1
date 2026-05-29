/**
 * POST /api/ai/continue — the engine behind Flow's in-flow continuation.
 *
 * Stance (see docs/AI_NATIVE_WORKSPACE_PLAN.md): Forge amplifies the human
 * in the act of writing — instantly, reversibly, never taking over. This
 * endpoint returns a SHORT continuation of whatever the user is typing,
 * in their voice, grounded in the surrounding text. The editor renders it
 * as dim ghost text the user accepts with Tab or ignores by typing on.
 *
 * Optimised for latency, not length: FAST_MODEL, a tight token budget, low
 * temperature. The whole point is that it feels instant — a slow completion
 * is a failed completion.
 *
 * Security posture mirrors the other AI routes: requireUser + rate limit +
 * bounded inputs; response is the continuation text only.
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";
import { FAST_MODEL, groqChat } from "@/lib/ai/groq";

const MAX_BEFORE_CHARS = 4_000;
const MAX_AFTER_CHARS = 1_000;

type Intent = "phrase" | "line";

const SYSTEM_PROMPT = `You are the in-flow writing companion inside Forge, a general workspace. The user is mid-sentence; you continue their text so they stay in flow.

Hard rules:
- Continue seamlessly from where BEFORE ends. Do NOT repeat any of the BEFORE text.
- Match the user's voice, tone, register, and formatting exactly. You are them, not an assistant.
- Return ONLY the raw continuation text — no quotes, no labels, no markdown, no commentary.
- Be SHORT: finish the current thought. A phrase or one sentence. Never a paragraph.
- If BEFORE ends mid-word, complete that word first.
- If a natural continuation isn't clear, return an empty string rather than guessing wildly.
- Never invent facts, names, numbers, or citations that the surrounding text doesn't support.
- Begin with a leading space only if BEFORE does not already end with whitespace and a space is grammatically needed.`;

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "ai.continue", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  try {
    const body = (await request.json()) as {
      before?: unknown;
      after?: unknown;
      intent?: unknown;
    };

    const before = typeof body.before === "string" ? body.before.slice(-MAX_BEFORE_CHARS) : "";
    const after = typeof body.after === "string" ? body.after.slice(0, MAX_AFTER_CHARS) : "";
    const intent: Intent = body.intent === "line" ? "line" : "phrase";

    if (!before.trim()) {
      // Nothing to continue from — return an empty completion, not an error,
      // so the client can treat "no suggestion" as a normal state.
      return Response.json({ completion: "" });
    }

    const lengthHint =
      intent === "line"
        ? "Continue with at most one sentence."
        : "Continue with a short phrase (a few words), just enough to keep momentum.";

    const userPrompt = [
      after.trim() ? `TEXT AFTER THE CURSOR (do not duplicate; continue toward it):\n${after}\n` : "",
      `${lengthHint}\n`,
      `BEFORE (continue from the end of this):\n${before}`,
    ]
      .filter(Boolean)
      .join("\n");

    const result = await groqChat({
      model: FAST_MODEL,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: intent === "line" ? 40 : 24,
      temperature: 0.3,
    });

    // Strip stray wrapping quotes/newlines the model sometimes adds.
    let completion = (result.content ?? "").replace(/^\s*\n+/, "");
    completion = completion.replace(/^["“”']+|["“”']+$/g, "");
    // Never echo the tail of BEFORE back to the user.
    const tail = before.slice(-40);
    if (tail && completion.startsWith(tail)) {
      completion = completion.slice(tail.length);
    }

    return Response.json({ completion });
  } catch (error) {
    console.error("[ai.continue] upstream failure", {
      message: error instanceof Error ? error.message : "unknown",
    });
    // Fail soft: an empty completion just means "no ghost this time".
    return Response.json({ completion: "" });
  }
}
