/**
 * POST /api/research/chat/past-you
 *
 * The Past-You chat — SSE-streamed temporal conversation where the
 * assistant speaks as the user as-of a chosen date. Same wire format
 * as /api/research/chat/stream so the existing useChatStream client
 * works with no changes.
 *
 * Body:
 *   {
 *     asOf:        "2026-03-14T00:00:00Z" | ISO string  (required)
 *     userMessage: string                                  (required)
 *     history:     { role: "user"|"assistant", content }[] (optional)
 *     projectId:   string                                  (optional)
 *     projectName: string                                  (optional)
 *   }
 *
 * The whole point: every tool the agent calls is temporally
 * scoped to ≤ asOf, and the system prompt forces the model to
 * answer in first person, with verbatim quotes + dates, refusing
 * to invent anything past-you wouldn't have known.
 *
 * No external research tools — past-you can't browse the web.
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
  asOf?: unknown;
  projectName?: unknown;
  projectId?: unknown;
  history?: unknown;
  userMessage?: unknown;
}

function buildSystemPrompt(args: { asOf: string; projectName: string | null }): string {
  return `You are the user, speaking AS THEM, but from the past. The "as-of" date is ${args.asOf}.

You ONLY know things that the user had written, said, or scheduled on or before ${args.asOf}. You do NOT know anything that happened after — no news, no later docs, no later chats, no later calendar events.

Use these tools to ground every answer:
  • past_docs_list                 — index of YOUR docs as of the date.
  • past_docs_read                 — full content of one doc (will tell you if it has been edited since).
  • past_conversations_search      — your own chat messages from on or before the date.

How to respond:
  • Speak in first person ("I wrote…", "I was worried…", "I'd decided…").
  • Always include a VERBATIM quote when grounding a claim, formatted in single quotes, followed by a citation: (from your doc "Title", written ${args.asOf.slice(0, 10)}).
  • If a doc has been edited since ${args.asOf} (the tool returns staleSinceAsOf:true), hedge: "this is roughly what I wrote — the doc was edited later, so I can't be sure of the exact words from that day."
  • If you don't have evidence, say so directly: "I don't have a record of that as of ${args.asOf}." DO NOT invent.
  • Keep the tone reflective and present — past-you is real, not a chatbot. Avoid robotic phrases.
  • Length: as long as the evidence supports, no longer. A two-sentence answer with a quote beats five sentences of speculation.

Active project context: ${args.projectName ?? "(none — answer across the whole workspace)"}.

You may NOT call any external research tools. You can only know what you knew then.`;
}

export async function POST(request: Request): Promise<Response> {
  const auth = await requireUser(request);
  if (isAuthFailure(auth)) return auth;

  const rl = enforceRateLimit(
    request,
    { routeId: "research.chat.past-you", ...RATE_LIMIT_EXPENSIVE },
    identifyClient(request, auth.uid),
  );
  if (!rl.ok) return rateLimitResponse(rl);

  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const asOfRaw = typeof body.asOf === "string" ? body.asOf : "";
  const asOfMs = asOfRaw ? Date.parse(asOfRaw) : NaN;
  if (!Number.isFinite(asOfMs)) {
    return NextResponse.json({ error: "asOf must be an ISO timestamp" }, { status: 400 });
  }
  if (asOfMs > Date.now() + 60_000) {
    return NextResponse.json(
      { error: "asOf must be in the past — past-you can't see the future." },
      { status: 400 },
    );
  }
  const asOf = new Date(asOfMs).toISOString();

  const rawUserMessage = typeof body.userMessage === "string" ? body.userMessage.trim() : "";
  if (!rawUserMessage) {
    return NextResponse.json({ error: "userMessage required" }, { status: 400 });
  }
  if (rawUserMessage.length > MAX_TURN_CHARS) {
    return NextResponse.json(
      { error: `userMessage too long (max ${MAX_TURN_CHARS} chars)` },
      { status: 400 },
    );
  }

  // Same guard pipeline as the live chat route.
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
  logRedactions(`uid=${auth.uid} past-you`, redaction.counts);
  const userMessage = redaction.text;

  // History — only the recent turns of the live conversation are
  // relevant context for the past-you persona's next reply. Redact
  // PII on each.
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
    history.push({ role, content: redactPii(content).text });
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

  const system = buildSystemPrompt({ asOf, projectName });
  const registry = buildRegistry({ groups: ["past-you"] });
  const messages: ChatMessage[] = [
    ...trimmed.map((t) => ({ role: t.role, content: t.content }) as ChatMessage),
    { role: "user", content: userMessage },
  ];

  console.log(
    `[research.chat.past-you] ← uid=${auth.uid} asOf=${asOf} project=${projectId ?? "(none)"} historyTurns=${trimmed.length}`,
  );

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
          console.warn("[past-you] enqueue failed:", err instanceof Error ? err.message : err);
        }
      };
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          /* closed */
        }
      }, 10_000);

      try {
        const result = await runAgent({
          system,
          messages,
          registry,
          ctx: {
            uid: auth.uid,
            projectId,
            startedAt: Date.now(),
            asOf,
          },
          model: DEFAULT_MODEL,
          maxTurns: 6,
          temperature: 0.45,
          perCallTimeoutMs: 30_000,
          onEvent: (e) => write(e),
        });
        void recordTokensAndCheckBudget(result.tokens.total);
        write({ kind: "done" });
      } catch (err) {
        const message = err instanceof Error ? err.message : "unknown";
        console.error("[past-you] agent throw:", message);
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
      "X-Accel-Buffering": "no",
    },
  });
}
