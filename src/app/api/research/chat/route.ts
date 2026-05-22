/**
 * POST /api/research/chat
 *
 * Multi-turn chat for /research. Accepts the conversation transcript
 * (previous turns) + a new user message, and returns the assistant
 * turn from Groq (Llama 3.3 70B Versatile).
 *
 * The endpoint is intentionally simple: no tool-use, no streaming
 * (yet), no retrieval injection. The client owns Firestore persistence
 * — `appendMessage` is called twice (user turn, assistant turn). This
 * keeps the route stateless and easy to retry on the client side.
 *
 * Security posture:
 *   • requireUser — Firebase ID token
 *   • RATE_LIMIT_EXPENSIVE — Groq is metered (free tier)
 *   • Transcript capped at 40 turns + 16k chars total
 *   • Output is the model's text only — no raw upstream object
 */

import { isAuthFailure, requireUser } from "@/lib/server/api-auth";
import {
  enforceRateLimit,
  identifyClient,
  rateLimitResponse,
  RATE_LIMIT_EXPENSIVE,
} from "@/lib/server/rate-limit";
import { DEFAULT_MODEL, groqChat, type ChatMessage } from "@/lib/ai/groq";

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
  history?: unknown;
  userMessage?: unknown;
}

const DEFAULT_SYSTEM = `You are Forge, an AI research workspace assistant.
You help researchers, writers, and operators reason about their work.
Respond clearly and in plain language. Cite sources when you reference outside facts.
Stay grounded in the user's project context when one is provided.
If a question is ambiguous, ask one short clarifying question instead of guessing.`;

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
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const userMessage =
    typeof body.userMessage === "string" ? body.userMessage.trim() : "";
  if (!userMessage) {
    return Response.json({ error: "userMessage is required" }, { status: 400 });
  }
  if (userMessage.length > MAX_TURN_CHARS) {
    return Response.json(
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
  // Keep only the most recent N turns once total cap is respected.
  const trimmed = history.slice(-MAX_TURNS);

  const projectName =
    typeof body.projectName === "string" && body.projectName.trim()
      ? body.projectName.trim().slice(0, 120)
      : null;
  const systemOverride =
    typeof body.systemPrompt === "string" && body.systemPrompt.trim()
      ? body.systemPrompt.trim().slice(0, 2_000)
      : null;

  const system = [
    systemOverride ?? DEFAULT_SYSTEM,
    projectName
      ? `\nProject context: the user is working inside a project called "${projectName}". Keep your responses relevant to that work when possible.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const messages: ChatMessage[] = [
    ...trimmed.map((t) => ({ role: t.role, content: t.content }) as ChatMessage),
    { role: "user", content: userMessage },
  ];

  try {
    const result = await groqChat({
      model: DEFAULT_MODEL,
      system,
      messages,
      maxTokens: 2048,
      temperature: 0.6,
    });
    return Response.json({
      role: "assistant" as const,
      content: result.content,
      stopReason: result.stopReason,
      tokenUsage: result.tokenUsage,
    });
  } catch (err) {
    console.error("[research.chat] upstream failure", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return Response.json(
      { error: "AI response failed" },
      { status: 500 },
    );
  }
}
