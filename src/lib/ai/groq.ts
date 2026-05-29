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
import tls from "node:tls";

installSystemCertificatesForNodeFetch();

export const DEFAULT_MODEL = "llama-3.3-70b-versatile";
export const FAST_MODEL = "llama-3.1-8b-instant";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;

function installSystemCertificatesForNodeFetch(): void {
  const tlsWithSystemCa = tls as typeof tls & {
    getCACertificates?: (type?: "default" | "system" | "bundled" | "extra") => string[];
    setDefaultCACertificates?: (certs: string[]) => void;
  };
  if (!tlsWithSystemCa.getCACertificates || !tlsWithSystemCa.setDefaultCACertificates) {
    return;
  }
  try {
    const current = tlsWithSystemCa.getCACertificates("default");
    const system = tlsWithSystemCa.getCACertificates("system");
    if (system.length === 0) return;
    const merged = Array.from(new Set([...current, ...system]));
    if (merged.length > current.length) {
      tlsWithSystemCa.setDefaultCACertificates(merged);
    }
  } catch (err) {
    console.warn(
      "[groq] could not install system CA certificates:",
      err instanceof Error ? err.message : err,
    );
  }
}

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
  reasoningEffort?: "none" | "default" | "low" | "medium" | "high";
  reasoningFormat?: "hidden" | "parsed";
  tools?: ToolDefinition[];
  toolChoice?: ToolChoice;
  timeoutMs?: number;
  /** Optional token-level delta callback — receives each content
   * chunk as Groq streams it. When set, `groqChat` issues a
   * stream:true request and assembles the final `content` itself so
   * the return shape stays identical. */
  onDelta?: (delta: string) => void;
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

  const wantsStream = !!req.onDelta;
  const body: Record<string, unknown> = {
    model,
    messages: messages.map(serializeMessage),
    max_completion_tokens: maxTokens,
    temperature,
  };
  if (typeof req.topP === "number") body.top_p = req.topP;
  if (req.jsonResponse) body.response_format = { type: "json_object" };
  if (req.reasoningEffort) body.reasoning_effort = req.reasoningEffort;
  if (req.reasoningFormat) body.reasoning_format = req.reasoningFormat;
  if (req.tools && req.tools.length > 0) {
    body.tools = req.tools;
    body.tool_choice = req.toolChoice ?? "auto";
  }
  // Streaming + tools combine fine on the wire, but the tool-call
  // path needs the full assembled response anyway — so we only ask
  // for stream:true when the caller actually subscribed to deltas.
  if (wantsStream) {
    body.stream = true;
    body.stream_options = { include_usage: true };
  }

  console.log(
    `[groq] → POST ${ENDPOINT} model=${model} messages=${messages.length} promptChars=${promptChars} maxCompletionTokens=${maxTokens} tools=${req.tools?.length ?? 0} stream=${wantsStream ? "yes" : "no"} json=${req.jsonResponse ? "yes" : "no"}`,
  );

  try {
    // Retry envelope — Groq's edge occasionally drops a connection
    // mid-handshake on the cold-start path ("fetch failed" with no
    // status). We retry up to MAX_ATTEMPTS times with exponential
    // backoff for TRANSPORT errors (no response received) AND for
    // 5xx / 408 / 429 responses. 4xx other than 408/429 are user-
    // error and we bail immediately so we don't waste budget.
    const MAX_ATTEMPTS = 3;
    const BACKOFFS_MS = [400, 1200];
    let res: Response | null = null;
    let lastTransportError: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        res = await fetch(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${trimmedKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        // Retry on the explicit-transient HTTP codes.
        if (res.status === 502 || res.status === 503 || res.status === 504 || res.status === 408 || res.status === 429) {
          if (attempt < MAX_ATTEMPTS) {
            console.warn(
              `[groq] ⚠ ${res.status} on attempt ${attempt}/${MAX_ATTEMPTS} — retrying after ${BACKOFFS_MS[attempt - 1]}ms`,
            );
            await new Promise((r) => setTimeout(r, BACKOFFS_MS[attempt - 1]));
            continue;
          }
        }
        break;
      } catch (err) {
        // Abort = caller cancelled. Don't retry.
        if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
          throw err;
        }
        lastTransportError = err;
        if (attempt < MAX_ATTEMPTS) {
          const detail = err instanceof Error ? err.message : "unknown";
          console.warn(
            `[groq] ⚠ transport "${detail}" on attempt ${attempt}/${MAX_ATTEMPTS} — retrying after ${BACKOFFS_MS[attempt - 1]}ms`,
          );
          await new Promise((r) => setTimeout(r, BACKOFFS_MS[attempt - 1]));
          continue;
        }
        // Exhausted retries — surface the last error.
        const classified = classifyTransportError(err);
        console.error(`[groq] ✗ transport error after ${MAX_ATTEMPTS} attempts in ${Date.now() - t0}ms — ${classified.log}`);
        throw new GroqApiError(classified.userMessage, 0, classified.detail);
      }
    }
    if (!res) {
      const classified = classifyTransportError(lastTransportError);
      throw new GroqApiError(classified.userMessage, 0, classified.detail);
    }

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

    // Streaming branch — Groq returns OpenAI-compatible SSE chunks.
    // We assemble the full content + tool_calls so the return shape
    // stays identical to the non-streaming path; the only difference
    // is `onDelta` fires for every content fragment as it arrives.
    if (wantsStream && res.body) {
      const assembled = await consumeGroqStream(res.body, req.onDelta);
      const finalMs = Date.now() - t0;
      console.log(
        `[groq] ✓ stream done in ${finalMs}ms model=${assembled.model ?? model} tokens=in:${assembled.usage.prompt_tokens}/out:${assembled.usage.completion_tokens}/total:${assembled.usage.total_tokens} contentChars=${assembled.content.length} toolCalls=${assembled.toolCalls.length} stop=${assembled.finishReason}`,
      );
      return {
        content: assembled.content,
        toolCalls: assembled.toolCalls,
        stopReason: assembled.finishReason,
        tokenUsage: {
          input: assembled.usage.prompt_tokens,
          output: assembled.usage.completion_tokens,
          total: assembled.usage.total_tokens,
        },
        model: assembled.model ?? model,
        durationMs: finalMs,
      };
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
    // Retry envelope above already classified transport errors;
    // anything reaching here is either a GroqApiError we should
    // re-raise as-is, or an AbortError from the timeout signal.
    if (err instanceof GroqApiError) throw err;
    if (err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError")) {
      throw new GroqApiError(
        `Groq request timed out after ${req.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
        0,
      );
    }
    const classified = classifyTransportError(err);
    console.error(`[groq] ✗ unexpected error in ${Date.now() - t0}ms — ${classified.log}`);
    throw new GroqApiError(classified.userMessage, 0, classified.detail);
  } finally {
    clearTimeout(timeout);
  }
}

function classifyTransportError(err: unknown): {
  userMessage: string;
  detail: string;
  log: string;
} {
  const message = err instanceof Error ? err.message : "unknown";
  const cause = err instanceof Error
    ? (err as Error & { cause?: { code?: string; message?: string } }).cause
    : undefined;
  const code = cause?.code;
  const causeMessage = cause?.message;

  if (code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
    return {
      userMessage:
        "Groq transport error: Node could not verify Groq's TLS certificate. Forge tried to load system CAs; if this persists, restart the dev server with `npm run dev` so NODE_OPTIONS=--use-system-ca is applied.",
      detail: `${code}: ${causeMessage ?? message}`,
      log: `${message}; cause=${code} ${causeMessage ?? ""}`.trim(),
    };
  }

  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return {
      userMessage: "Groq transport error: DNS lookup failed. Check network/DNS and retry.",
      detail: `${code}: ${causeMessage ?? message}`,
      log: `${message}; cause=${code} ${causeMessage ?? ""}`.trim(),
    };
  }

  if (code === "ECONNRESET" || code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") {
    return {
      userMessage: "Groq transport error: connection timed out or was reset. Retrying may succeed.",
      detail: `${code}: ${causeMessage ?? message}`,
      log: `${message}; cause=${code} ${causeMessage ?? ""}`.trim(),
    };
  }

  return {
    userMessage: `Groq transport error: ${message}`,
    detail: causeMessage ?? message,
    log: causeMessage ? `${message}; cause=${causeMessage}` : message,
  };
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

/* ─────────────────── stream parsing ─────────────────── */

interface StreamedToolCallFragment {
  index: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
}

interface StreamedChoice {
  index?: number;
  delta?: {
    role?: string;
    content?: string | null;
    tool_calls?: StreamedToolCallFragment[];
  };
  finish_reason?: string | null;
}

interface StreamedChunk {
  id?: string;
  model?: string;
  choices?: StreamedChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface AssembledStreamResult {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string;
  model: string | null;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

/**
 * Consume a Groq SSE response body and assemble the equivalent of a
 * non-streaming response. Fires `onDelta(text)` for every content
 * fragment so the UI can paint tokens as they arrive.
 *
 * Tool-call fragments are accumulated by `index` per the OpenAI spec:
 *
 *   tool_calls[0]: { id: "call_x", function: { name: "search" } }
 *   tool_calls[0]: { function: { arguments: '{"q' } }
 *   tool_calls[0]: { function: { arguments: '":"hi"}' } }
 *   tool_calls[1]: { id: "call_y", function: { name: "list" } }
 *
 * → assembled as two calls.
 */
async function consumeGroqStream(
  body: ReadableStream<Uint8Array>,
  onDelta: ((d: string) => void) | undefined,
): Promise<AssembledStreamResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  let content = "";
  let finishReason = "stop";
  let model: string | null = null;
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

  // Per-index assembly for tool calls.
  const partial = new Map<number, { id: string; name: string; arguments: string }>();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const frames = buffer.split(/\n\n/);
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      for (const line of frame.split(/\n/)) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let chunk: StreamedChunk;
        try {
          chunk = JSON.parse(payload) as StreamedChunk;
        } catch {
          continue;
        }
        if (!model && chunk.model) model = chunk.model;
        if (chunk.usage) {
          usage.prompt_tokens = chunk.usage.prompt_tokens ?? usage.prompt_tokens;
          usage.completion_tokens = chunk.usage.completion_tokens ?? usage.completion_tokens;
          usage.total_tokens = chunk.usage.total_tokens ?? usage.total_tokens;
        }

        const choice = chunk.choices?.[0];
        if (!choice) continue;

        const delta = choice.delta;
        if (delta?.content) {
          content += delta.content;
          onDelta?.(delta.content);
        }
        if (delta?.tool_calls) {
          for (const frag of delta.tool_calls) {
            const idx = typeof frag.index === "number" ? frag.index : 0;
            const cur =
              partial.get(idx) ?? { id: "", name: "", arguments: "" };
            if (frag.id) cur.id = frag.id;
            if (frag.function?.name) cur.name = frag.function.name;
            if (typeof frag.function?.arguments === "string") {
              cur.arguments += frag.function.arguments;
            }
            partial.set(idx, cur);
          }
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
    }
  }

  const toolCalls: ToolCall[] = Array.from(partial.entries())
    .sort(([a], [b]) => a - b)
    .map(([, v]) => ({
      id: v.id || `call_${Math.random().toString(36).slice(2, 10)}`,
      type: "function" as const,
      function: { name: v.name, arguments: v.arguments || "{}" },
    }))
    .filter((c) => c.function.name);

  return { content, toolCalls, finishReason, model, usage };
}
