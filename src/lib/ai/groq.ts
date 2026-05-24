/**
 * Groq — the single AI provider for Forge.
 *
 * Wired to the official OpenAI-compatible chat-completion endpoint at
 *   POST https://api.groq.com/openai/v1/chat/completions
 *
 *   Headers:
 *     Authorization: Bearer $GROQ_API_KEY
 *     Content-Type:  application/json
 *
 *   Body:
 *     {
 *       model:                  string,             // REQUIRED
 *       messages:               ChatMessage[],      // REQUIRED
 *       max_completion_tokens?: number,
 *       temperature?:           number,
 *       top_p?:                 number,
 *       response_format?:       { type: "json_object" } | { type: "json_schema", json_schema: ... },
 *       tools?:                 ToolDefinition[],   // function calling
 *       tool_choice?:           "auto" | "none" | "required" | { type: "function", function: { name } }
 *     }
 *
 *   Tool-call response shape:
 *     {
 *       choices: [{
 *         message: {
 *           role: "assistant",
 *           content: null,                            // null when tools are invoked
 *           tool_calls: [{
 *             id:       "call_abc",
 *             type:     "function",
 *             function: { name: "...", arguments: "<JSON string>" }
 *           }]
 *         },
 *         finish_reason: "tool_calls"
 *       }]
 *     }
 *
 *   On the next turn the caller appends:
 *     { role: "assistant", content: "", tool_calls: [...] }       // echo the assistant's call
 *     { role: "tool", tool_call_id: "call_abc", content: "<json>" } // one per call
 *
 * Models:
 *   • DEFAULT_MODEL = llama-3.3-70b-versatile  — chat + tool-call agents
 *   • FAST_MODEL    = llama-3.1-8b-instant     — short classification calls
 *
 * Server-only.
 */

import "server-only";

export const DEFAULT_MODEL = "llama-3.3-70b-versatile";
export const FAST_MODEL = "llama-3.1-8b-instant";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** Arguments are a JSON-encoded string per the OpenAI spec. */
    arguments: string;
  };
}

export interface ChatMessage {
  role: ChatRole;
  /** Null/empty when the assistant turn is purely tool_calls. */
  content?: string | null;
  /** Set on assistant turns that issued one or more tool calls. */
  tool_calls?: ToolCall[];
  /** Set on `role: "tool"` turns. Echoes the call's `id`. */
  tool_call_id?: string;
  /** Optional friendly name for the tool message (some routers use it). */
  name?: string;
}

/* ─────────────────────── tool definitions ─────────────────────── */

/** A JSON-Schema-ish parameter spec — what Groq expects under
 * `tools[].function.parameters`. Kept loose so feature modules can
 * declare their own schemas without dragging in a Zod-style runtime. */
export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolParameterSchema;
  };
}

export type ToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } };

/* ─────────────────────── request / result ─────────────────────── */

export interface GroqRequest {
  model?: string;
  messages: ChatMessage[];
  system?: string;
  maxTokens?: number;
  maxCompletionTokens?: number;
  temperature?: number;
  topP?: number;
  jsonResponse?: boolean;
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  timeoutMs?: number;
}

export interface GroqResult {
  /** Empty string when the turn was purely tool calls. */
  content: string;
  /** Populated when the model decided to invoke one or more tools. */
  toolCalls: ToolCall[];
  stopReason: string;
  tokenUsage: { input: number; output: number; total: number };
  model: string;
  durationMs: number;
}

interface ChatCompletionResponse {
  id?: string;
  model?: string;
  choices?: Array<{
    index?: number;
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface ChatCompletionError {
  error?: { message?: string; type?: string; code?: string };
}

export class GroqApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public detail?: string,
  ) {
    super(message);
    this.name = "GroqApiError";
  }
}

/* ─────────────────────── core call ─────────────────────── */

export async function groqChat(req: GroqRequest): Promise<GroqResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new GroqApiError(
      "GROQ_API_KEY is not configured. Set it in .env.local and restart `next dev`.",
      0,
    );
  }
  const trimmedKey = apiKey.trim();
  if (!trimmedKey) throw new GroqApiError("GROQ_API_KEY is empty after trim.", 0);

  const model = req.model ?? process.env.GROQ_MODEL ?? DEFAULT_MODEL;
  const messages: ChatMessage[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  for (const m of req.messages) messages.push(m);

  if (messages.length === 0) {
    throw new GroqApiError("groqChat called with zero messages.", 0);
  }

  const maxTokens = req.maxCompletionTokens ?? req.maxTokens ?? 1024;
  const temperature = req.temperature ?? 0.4;
  const promptChars = messages.reduce(
    (n, m) => n + (typeof m.content === "string" ? m.content.length : 0),
    0,
  );

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  const t0 = Date.now();

  const body: Record<string, unknown> = {
    model,
    messages: messages.map(serializeMessage),
    max_completion_tokens: maxTokens,
    max_tokens: maxTokens,
    temperature,
  };
  if (typeof req.topP === "number") body.top_p = req.topP;
  if (req.jsonResponse) body.response_format = { type: "json_object" };
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools;
    body.tool_choice = req.toolChoice ?? "auto";
  }

  console.log(
    `[groq] → POST ${ENDPOINT} model=${model} messages=${messages.length} promptChars=${promptChars} maxCompletionTokens=${maxTokens} tools=${req.tools?.length ?? 0} json=${req.jsonResponse ? "yes" : "no"}`,
  );

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${trimmedKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const durationMs = Date.now() - t0;

    if (!res.ok) {
      let detail = `${res.status} ${res.statusText}`;
      try {
        const errBody = (await res.json()) as ChatCompletionError;
        if (errBody.error?.message) detail = errBody.error.message;
      } catch {
        try {
          detail = await res.text();
        } catch {
          /* keep status line */
        }
      }
      console.error(
        `[groq] ✗ ${res.status} ${res.statusText} in ${durationMs}ms — ${detail}`,
      );
      throw new GroqApiError(`Groq ${res.status}: ${detail}`, res.status, detail);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const choice = data.choices?.[0];
    const content = choice?.message?.content ?? "";
    const toolCalls = choice?.message?.tool_calls ?? [];
    const usage = data.usage ?? {};

    console.log(
      `[groq] ✓ ${res.status} in ${durationMs}ms model=${data.model ?? model} tokens=in:${usage.prompt_tokens ?? 0}/out:${usage.completion_tokens ?? 0}/total:${usage.total_tokens ?? 0} contentChars=${(content ?? "").length} toolCalls=${toolCalls.length} stop=${choice?.finish_reason ?? "stop"}`,
    );

    return {
      content: content ?? "",
      toolCalls,
      stopReason: choice?.finish_reason ?? "stop",
      tokenUsage: {
        input: usage.prompt_tokens ?? 0,
        output: usage.completion_tokens ?? 0,
        total: usage.total_tokens ?? 0,
      },
      model: data.model ?? model,
      durationMs,
    };
  } catch (err) {
    if (err instanceof GroqApiError) throw err;
    const msg = err instanceof Error ? err.message : "unknown";
    console.error(`[groq] ✗ transport error in ${Date.now() - t0}ms — ${msg}`);
    if (err instanceof Error && err.name === "AbortError") {
      throw new GroqApiError(
        `Groq request timed out after ${req.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
        0,
      );
    }
    throw new GroqApiError(`Groq transport error: ${msg}`, 0);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Normalise a ChatMessage to the exact wire shape Groq expects. The
 * OpenAI spec requires `content` to be a string (or null when
 * `tool_calls` is set), and `tool_call_id` only on `role: "tool"`
 * turns. We strip undefined keys so the JSON stays minimal.
 */
function serializeMessage(m: ChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: m.role };
  if (m.role === "tool") {
    out.tool_call_id = m.tool_call_id;
    out.content = m.content ?? "";
    if (m.name) out.name = m.name;
    return out;
  }
  if (m.tool_calls && m.tool_calls.length > 0) {
    out.tool_calls = m.tool_calls;
    out.content = m.content ?? "";
    return out;
  }
  out.content = m.content ?? "";
  return out;
}
