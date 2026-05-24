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
 *   Body (per Groq's spec):
 *     {
 *       model:                  string,             // REQUIRED
 *       messages:               ChatMessage[],      // REQUIRED
 *       max_completion_tokens?: number,             // preferred over deprecated `max_tokens`
 *       temperature?:           number,
 *       top_p?:                 number,
 *       stream?:                boolean,
 *       response_format?:       { type: "json_object" } | { type: "json_schema", json_schema: ... }
 *     }
 *
 *   Response:
 *     {
 *       id, object, created, model,
 *       choices: [{ index, message: { role, content }, finish_reason }],
 *       usage:   { prompt_tokens, completion_tokens, total_tokens }
 *     }
 *
 * Env:
 *   GROQ_API_KEY            (required)
 *   GROQ_MODEL              (optional override)
 *
 * Models:
 *   • DEFAULT_MODEL = llama-3.3-70b-versatile  — user-visible chat + scans
 *   • FAST_MODEL    = llama-3.1-8b-instant     — tight loops / classification
 *
 * Server-only — never import from `"use client"`.
 *
 * Logging:
 *   Every request prints a single line summarizing model, message
 *   count, prompt-char count, and response token usage on success
 *   (or the upstream error body on failure). Lets you watch the
 *   Groq console light up in real time during dev.
 */

import "server-only";

export const DEFAULT_MODEL = "llama-3.3-70b-versatile";
export const FAST_MODEL = "llama-3.1-8b-instant";
const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface GroqRequest {
  model?: string;
  messages: ChatMessage[];
  system?: string;
  /** Legacy alias. If both are set, `maxCompletionTokens` wins. */
  maxTokens?: number;
  maxCompletionTokens?: number;
  temperature?: number;
  topP?: number;
  jsonResponse?: boolean;
  timeoutMs?: number;
}

export interface GroqResult {
  content: string;
  /** OpenAI / Groq finish_reason: "stop" | "length" | "tool_calls" | "content_filter". */
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
    message?: { role?: string; content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface ChatCompletionError {
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
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

/**
 * Single-shot chat completion. Always calls Groq when invoked — no
 * gating on prompt length / nothing-to-do shortcuts. Callers are
 * responsible for not invoking with an empty prompt.
 */
export async function groqChat(req: GroqRequest): Promise<GroqResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new GroqApiError(
      "GROQ_API_KEY is not configured. Set it in .env.local and restart `next dev`.",
      0,
    );
  }
  const trimmedKey = apiKey.trim();
  if (trimmedKey.length === 0) {
    throw new GroqApiError("GROQ_API_KEY is empty after trim.", 0);
  }

  const model = req.model ?? process.env.GROQ_MODEL ?? DEFAULT_MODEL;
  const messages: ChatMessage[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  for (const m of req.messages) messages.push(m);

  if (messages.length === 0) {
    throw new GroqApiError("groqChat called with zero messages.", 0);
  }

  const maxTokens = req.maxCompletionTokens ?? req.maxTokens ?? 1024;
  const temperature = req.temperature ?? 0.4;
  const promptChars = messages.reduce((n, m) => n + m.content.length, 0);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  const t0 = Date.now();

  const body: Record<string, unknown> = {
    model,
    messages,
    // `max_completion_tokens` is the Groq-preferred name. We also
    // emit `max_tokens` for compatibility with older client cuts of
    // the OpenAI spec — Groq treats them as equivalent.
    max_completion_tokens: maxTokens,
    max_tokens: maxTokens,
    temperature,
  };
  if (typeof req.topP === "number") body.top_p = req.topP;
  if (req.jsonResponse) body.response_format = { type: "json_object" };

  console.log(
    `[groq] → POST ${ENDPOINT} model=${model} messages=${messages.length} promptChars=${promptChars} maxCompletionTokens=${maxTokens} json=${req.jsonResponse ? "yes" : "no"}`,
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
    const usage = data.usage ?? {};

    console.log(
      `[groq] ✓ ${res.status} in ${durationMs}ms model=${data.model ?? model} tokens=in:${usage.prompt_tokens ?? 0}/out:${usage.completion_tokens ?? 0}/total:${usage.total_tokens ?? 0} contentChars=${content.length} stop=${choice?.finish_reason ?? "stop"}`,
    );

    return {
      content,
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
      throw new GroqApiError(`Groq request timed out after ${req.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`, 0);
    }
    throw new GroqApiError(`Groq transport error: ${msg}`, 0);
  } finally {
    clearTimeout(timeout);
  }
}
