/**
 * POST /api/research/chat
 *
 * Multi-turn chat for /research, now running through the tool-using
 * agent loop. The assistant can:
 *
 *   • Read the user's project docs        (docs_list, docs_read)
 *   • Search the web for citations         (research_search, research_answer)
 *
 * Writes (calendar / tasks / doc create / doc update) are deliberately
 * NOT exposed here — the chat is for grounded reasoning, not silent
 * side-effects. Surfaces that need to mutate (Tempo, /editor, etc.)
 * mount their own agent runs with the appropriate registry.
 *
 * Response shape:
 *   {
 *     role: "assistant",
 *     content: string,              // final answer (never empty)
 *     steps: AgentStep[],           // every tool call, for the UI "used …" strip
 *     tokens: { input, output, total },
 *     model: string,
 *     durationMs: number,
 *     finishReason: "complete" | "max-turns" | "error",
 *     stopReason: string            // kept for back-compat with old client
 *   }
 *
 * Security posture:
 *   • requireUser — Firebase ID token
 *   • RATE_LIMIT_EXPENSIVE — Groq is metered
 *   • Transcript capped at 40 turns + 16k chars total
 *   • Agent loop capped at 6 turns
 */

import { NextResponse } from "next/server";
import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";
import { DEFAULT_MODEL, type ChatMessage } from "@/lib/ai/groq";
import { runAgent } from "@/lib/ai/agent";
import { buildRegistry } from "@/lib/ai/tools/registry";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_TURNS = 40;
const MAX_TOTAL_CHARS = 16_000;
const MAX_TURN_CHARS = 8_000;

interface IncomingTurn {
  role?: unknown;
  content?: unknown;
}

interface ChatBody {
  systemPrompt?: unknown;
  projectName?: unknown;
  projectId?: unknown;
  history?: unknown;
  userMessage?: unknown;
}

const DEFAULT_SYSTEM = `You are Forge, the assistant inside an AI reactive workspace.

You have tools — USE THEM when they help:
  • docs_list  → see what documents the user has in the active project.
  • docs_read  → read a specific doc's content before answering questions about it.
  • research_search / research_answer → look up external facts on the web with sources.

Discipline:
  • If the user references "my doc on X", "the launch plan", "what I wrote about Y", reach for docs_list → docs_read instead of guessing.
  • If the user asks something time-sensitive, current, or about the outside world, call research_search or research_answer and cite the URLs you return.
  • If you don't actually need a tool, just answer directly — don't pad turns with unnecessary tool calls.
  • Stay grounded: never invent a statistic, citation, or doc the workspace doesn't actually contain.
  • If a question is ambiguous, ask ONE short clarifying question instead of guessing.

Output:
  • Plain language, no headers unless the answer is long enough to benefit.
  • When you cite a web source, format as [domain.com](url) inline.
  • When you reference a doc you read, say "(from your doc 'Title')" so the user can locate it.`;

export async function POST(request: Request) {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "research.chat", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userMessage =
    typeof body.userMessage === "string" ? body.userMessage.trim() : "";
  if (!userMessage) {
    return NextResponse.json({ error: "userMessage is required" }, { status: 400 });
  }
  if (userMessage.length > MAX_TURN_CHARS) {
    return NextResponse.json(
      { error: `userMessage too long (max ${MAX_TURN_CHARS} chars)` },
      { status: 400 },
    );
  }

  const historyRaw = Array.isArray(body.history) ? body.history : [];
  const history: { role: "user" | "assistant"; content: string }[] = [];
  let totalChars = userMessage.length;
  for (let i = 0; i < historyRaw.length; i++) {
    const turn = historyRaw[i] as IncomingTurn;
    const role = turn.role;
    if (role !== "user" && role !== "assistant") continue;
    const content = typeof turn.content === "string" ? turn.content : "";
    if (!content) continue;
    if (totalChars + content.length > MAX_TOTAL_CHARS) break;
    history.push({ role, content });
    totalChars += content.length;
  }
  const trimmed = history.slice(-MAX_TURNS);

  const projectName =
    typeof body.projectName === "string" && body.projectName.trim()
      ? body.projectName.trim().slice(0, 120)
      : null;
  const projectId =
    typeof body.projectId === "string" && body.projectId.trim()
      ? body.projectId.trim()
      : null;
  const systemOverride =
    typeof body.systemPrompt === "string" && body.systemPrompt.trim()
      ? body.systemPrompt.trim().slice(0, 2_000)
      : null;

  const system = [
    systemOverride ?? DEFAULT_SYSTEM,
    projectName
      ? `\nActive project: "${projectName}"${projectId ? ` (id: ${projectId})` : ""}. Keep your responses relevant to that work.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Build a chat-flavoured registry: read docs + research. No writes
  // — see file header.
  const registry = buildRegistry({
    groups: ["docs:read", "research"],
  });

  const messages: ChatMessage[] = [
    ...trimmed.map((t) => ({ role: t.role, content: t.content }) as ChatMessage),
    { role: "user", content: userMessage },
  ];

  console.log(
    `[research.chat] ← uid=${auth.uid} project=${projectId ?? "(none)"} historyTurns=${trimmed.length} totalChars=${totalChars}`,
  );

  try {
    const result = await runAgent({
      system,
      messages,
      registry,
      ctx: {
        uid: auth.uid,
        projectId,
        startedAt: Date.now(),
      },
      model: DEFAULT_MODEL,
      maxTurns: 6,
      temperature: 0.5,
      perCallTimeoutMs: 30_000,
    });

    return NextResponse.json({
      role: "assistant" as const,
      content: result.message,
      steps: result.steps.map((s) => ({
        turn: s.turn,
        tool: s.tool,
        durationMs: s.durationMs,
      })),
      tokens: result.tokens,
      tokenUsage: { input: result.tokens.input, output: result.tokens.output },
      model: result.model,
      durationMs: result.durationMs,
      finishReason: result.finishReason,
      // Back-compat: older clients read `stopReason`.
      stopReason: result.finishReason === "complete" ? "stop" : result.finishReason,
    });
  } catch (err) {
    console.error("[research.chat] agent failure", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "AI response failed" },
      { status: 500 },
    );
  }
}
