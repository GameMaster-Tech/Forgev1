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
import { type ChatMessage } from "@/lib/ai/groq";
import { GroqApiError } from "@/lib/ai/groq";
import { resolveGroqModeConfig } from "@/lib/ai/models";
import { runAgent } from "@/lib/ai/agent";
import { buildRegistry } from "@/lib/ai/tools/registry";
import {
  checkPromptInjection,
  enforceDailyAiQuota,
  logRedactions,
  peekMonthlyBudget,
  recordTokensAndCheckBudget,
  redactPii,
} from "@/lib/server/llm-guard";

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
  modelId?: unknown;
  aiMode?: unknown;
  history?: unknown;
  userMessage?: unknown;
}

const DEFAULT_SYSTEM = `You are Forge, the assistant inside an AI-native reactive workspace. You can DO things in the workspace, not just answer — when the user asks you to make or change something, perform it with your tools and then confirm what you did. You are capable; never reply that you "can't execute this" — if a request maps to the tools below, just do it.

Your tools — USE THEM:
  • projects_list   → list the user's projects (id, name). Call this FIRST to resolve a project the user names ("the decision-making project") into its id.
  • projects_create → create a new project. Reuse an existing same-named one rather than duplicating.
  • docs_list       → see the documents in a project.
  • docs_read       → read a doc's full content before answering questions about it.
  • docs_create     → create a new document with HTML content (<p>, <h1>-<h3>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>, <a>).
  • docs_update     → edit a doc (mode: replace | append | prepend).
  • research_search / research_answer → look up external facts on the web with sources.

How to handle common requests:
  • "Create a project X and a doc Y that says …" → projects_create (or reuse) → docs_create with the returned projectId and the written HTML content. Then confirm with the doc title.
  • "Add a doc to the <name> project" → projects_list to find its id → docs_create.
  • "Update / add to my doc on X" → docs_list → docs_read → docs_update.
  • If asked to WRITE content (an essay, summary, notes), write it yourself into the doc's content — don't ask the user to write it.

Discipline:
  • If the user references "my doc on X" or "the launch plan", reach for docs_list → docs_read instead of guessing.
  • For anything time-sensitive or about the outside world, call research_search / research_answer and cite the URLs.
  • Don't pad turns with unnecessary tool calls; if no tool is needed, just answer.
  • Stay grounded: never invent a statistic, citation, or doc the workspace doesn't actually contain.

Output:
  • Plain language, no headers unless the answer is long enough to benefit.
  • After performing an action, briefly confirm it (e.g. "Created the doc 'Impact' in the AI project.").
  • Cite web sources inline as [domain.com](url); reference docs you read as "(from your doc 'Title')".`;

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

  const rawUserMessage =
    typeof body.userMessage === "string" ? body.userMessage.trim() : "";
  if (!rawUserMessage) {
    return NextResponse.json({ error: "userMessage is required" }, { status: 400 });
  }
  if (rawUserMessage.length > MAX_TURN_CHARS) {
    return NextResponse.json(
      { error: `userMessage too long (max ${MAX_TURN_CHARS} chars)` },
      { status: 400 },
    );
  }

  // LLM-guard pipeline — same shape as the SSE variant.
  const inj = checkPromptInjection(rawUserMessage);
  if (!inj.ok) {
    return NextResponse.json({ error: inj.reason ?? "Request blocked." }, { status: 400 });
  }
  const quota = await enforceDailyAiQuota(auth.uid);
  if (!quota.ok) {
    return NextResponse.json({ error: quota.reason ?? "Daily limit reached." }, { status: 429 });
  }
  const budget = await peekMonthlyBudget();
  if (!budget.ok) {
    return NextResponse.json({ error: budget.reason ?? "Service paused." }, { status: 503 });
  }
  const redaction = redactPii(rawUserMessage);
  logRedactions(`uid=${auth.uid} chat`, redaction.counts);
  const userMessage = redaction.text;

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

  // Full workspace registry: the assistant can find/create projects,
  // read + create + update docs, and search the web. This is what makes
  // "create a project and a doc and write it" actually execute.
  const registry = buildRegistry({
    groups: ["docs", "projects", "research"],
  });
  const modelConfig = resolveGroqModeConfig({
    model: typeof body.modelId === "string" ? body.modelId : null,
    mode: typeof body.aiMode === "string" ? body.aiMode : null,
  });

  const messages: ChatMessage[] = [
    ...trimmed.map(
      (t) =>
        ({ role: t.role, content: redactPii(t.content).text }) as ChatMessage,
    ),
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
      model: modelConfig.model,
      maxCompletionTokens: modelConfig.maxCompletionTokens,
      reasoningEffort: modelConfig.reasoningEffort,
      reasoningFormat: modelConfig.reasoningFormat,
      maxTurns: 6,
      temperature: 0.5,
      perCallTimeoutMs: 30_000,
    });

    void recordTokensAndCheckBudget(result.tokens.total);

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
    const message =
      err instanceof GroqApiError
        ? err.message
        : "AI response failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
