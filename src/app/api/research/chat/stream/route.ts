/**
 * POST /api/research/chat/stream
 *
 * Server-Sent Events variant of /api/research/chat. The agent loop
 * runs server-side as before, but every AgentEvent is flushed to the
 * client as it happens so the UI can render a Claude / Gemini-style
 * "thinking…" surface with per-tool chips and live "currently
 * browsing" source URLs.
 *
 * Wire format — one event per line, vanilla SSE:
 *
 *   data: {"kind":"thinking","turn":1,"text":"Thinking through what you asked…"}
 *
 *   data: {"kind":"tool_start","turn":1,"tool":"research_search",
 *          "label":"Searching the web for 'q3 hiring benchmarks'","query":"q3 hiring benchmarks"}
 *
 *   data: {"kind":"tool_done","turn":1,"tool":"research_search","durationMs":612,
 *          "label":"Found 6 web results","summary":"6 results",
 *          "sources":[{"url":"https://...","title":"..."}, ...]}
 *
 *   data: {"kind":"final","message":"Here's what I found…",
 *          "tokens":{"input":2103,"output":488,"total":2591},"model":"...",
 *          "durationMs":4892,"finishReason":"complete"}
 *
 *   data: [DONE]
 *
 * The non-streaming /api/research/chat route is kept as a fallback for
 * environments where the client can't open an EventSource (preview
 * iframes, older runtimes). useChatThread prefers stream; falls back.
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
import { runAgent, type AgentEvent } from "@/lib/ai/agent";
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

Output:
  • Plain language, no headers unless the answer is long enough to benefit.
  • When you cite a web source, format as [domain.com](url) inline.
  • When you reference a doc you read, say "(from your doc 'Title')" so the user can locate it.`;

export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "research.chat.stream", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const rawUserMessage = typeof body.userMessage === "string" ? body.userMessage.trim() : "";
  if (!rawUserMessage) {
    return NextResponse.json({ error: "userMessage is required" }, { status: 400 });
  }
  if (rawUserMessage.length > MAX_TURN_CHARS) {
    return NextResponse.json(
      { error: `userMessage too long (max ${MAX_TURN_CHARS} chars)` },
      { status: 400 },
    );
  }

  // 1. Cheap pattern-based prompt-injection guard — bail before
  //    spending a Groq call. Returns a friendly reason; safe to
  //    surface to the client.
  const inj = checkPromptInjection(rawUserMessage);
  if (!inj.ok) {
    return NextResponse.json({ error: inj.reason ?? "Request blocked." }, { status: 400 });
  }

  // 2. Per-user daily AI quota — atomic Firestore increment + cap.
  const quota = await enforceDailyAiQuota(auth.uid);
  if (!quota.ok) {
    return NextResponse.json({ error: quota.reason ?? "Daily limit reached." }, { status: 429 });
  }

  // 3. Global monthly budget kill-switch — refuse early if tripped.
  const budget = await peekMonthlyBudget();
  if (!budget.ok) {
    return NextResponse.json({ error: budget.reason ?? "Service paused." }, { status: 503 });
  }

  // 4. PII redaction — strip emails/phones/SSNs/cards/api-keys from
  //    the user message before it reaches Groq or any upstream log.
  const redaction = redactPii(rawUserMessage);
  logRedactions(`uid=${auth.uid} chat.stream`, redaction.counts);
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

  const registry = buildRegistry({ groups: ["docs:read", "research"] });

  // Redact every history turn too — a prior user turn could still
  // leak the PII we're trying to keep out of Groq.
  const messages: ChatMessage[] = [
    ...trimmed.map(
      (t) =>
        ({
          role: t.role,
          content: redactPii(t.content).text,
        }) as ChatMessage,
    ),
    { role: "user", content: userMessage },
  ];

  console.log(
    `[research.chat.stream] ← uid=${auth.uid} project=${projectId ?? "(none)"} historyTurns=${trimmed.length} quotaUsed=${quota.used}/${quota.cap}`,
  );

  // Build the SSE stream. We pump events as they arrive from the
  // agent's onEvent callback; the underlying Promise resolves when
  // the loop finishes (we've already emitted "final").
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (event: AgentEvent | { kind: "done" }) => {
        try {
          if (event.kind === "done") {
            controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
            return;
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch (err) {
          console.warn(
            "[research.chat.stream] enqueue failed:",
            err instanceof Error ? err.message : err,
          );
        }
      };

      // Heartbeat: SSE clients (and intermediate proxies) drop idle
      // connections after ~30s. Send a comment line every 10s so the
      // pipe stays alive during long Groq calls.
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          /* stream may have closed */
        }
      }, 10_000);

      try {
        const result = await runAgent({
          system,
          messages,
          registry,
          ctx: { uid: auth.uid, projectId, startedAt: Date.now() },
          model: DEFAULT_MODEL,
          maxTurns: 6,
          temperature: 0.5,
          perCallTimeoutMs: 30_000,
          onEvent: (e) => write(e),
        });
        // Budget accounting — recorded post-call so partial-stream
        // costs still count. Fire-and-forget: kill-switch fires on
        // the NEXT request, not this one.
        void recordTokensAndCheckBudget(result.tokens.total);
        write({ kind: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown";
        console.error("[research.chat.stream] agent throw:", message);
        write({ kind: "error", message });
        write({ kind: "done" });
      } finally {
        clearInterval(heartbeat);
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable Vercel's edge-buffering for SSE.
      "X-Accel-Buffering": "no",
    },
  });
}
