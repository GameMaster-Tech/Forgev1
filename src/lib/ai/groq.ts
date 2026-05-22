/**
 * Groq — the single AI provider for Forge.
 *
 * Replaces Anthropic across every server route. Groq runs the open
 * Llama models on custom hardware that's faster than any other free
 * inference API on the market (typical first-token latency 200–400ms,
 * ~600 tok/s after that). We hit it via the OpenAI-compatible chat
 * completion endpoint, so the integration is a thin fetch wrapper —
 * no extra SDK in the bundle.
 *
 *   Env:
 *     GROQ_API_KEY            (required)
 *     GROQ_MODEL              (optional override)
 *
 * Two models are wired:
 *   • DEFAULT_MODEL          — llama-3.3-70b-versatile. Use for
 *                              user-visible chat + writing assistance.
 *   • FAST_MODEL             — llama-3.1-8b-instant. Use for tight-
 *                              loop classification calls (contradiction
 *                              detection, claim verification) where
 *                              latency matters more than nuance.
 *
 * Server-only — never import from a `"use client"` file.
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
  /** Optional override; defaults to DEFAULT_MODEL. */
  model?: string;
  messages: ChatMessage[];
  /** Optional system prompt; prepended automatically if provided. */
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * When true, asks the model to respond with strict JSON. Groq
   * forwards this as `response_format: { type: "json_object" }` per
   * the OpenAI spec.
   */
  jsonResponse?: boolean;
  /** Force a specific timeout for short-fuse classification calls. */
  timeoutMs?: number;
}

export interface GroqResult {
  content: string;
  /**
   * Same enum as the OpenAI chat completion spec.
   * "stop" | "length" | "tool_calls" | "content_filter".
   */
  stopReason: string;
  tokenUsage: { input: number; output: number };
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { role?: string; content?: string };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/**
 * Single-shot chat completion. Throws on transport errors; returns
 * an empty-content result on a malformed upstream response so callers
 * can decide whether to fail closed or pass through.
 */
export async function groqChat(req: GroqRequest): Promise<GroqResult> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not configured. Set it in your environment to enable AI features.",
    );
  }

  const model = req.model ?? process.env.GROQ_MODEL ?? DEFAULT_MODEL;
  const messages: ChatMessage[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  for (const m of req.messages) messages.push(m);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: req.maxTokens ?? 1024,
        temperature: req.temperature ?? 0.4,
        ...(req.jsonResponse
          ? { response_format: { type: "json_object" } }
          : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      // Surface Groq's structured error body for easier debugging.
      let detail = `${res.status} ${res.statusText}`;
      try {
        const body = (await res.json()) as {
          error?: { message?: string };
        };
        if (body.error?.message) detail = body.error.message;
      } catch {
        /* opaque body */
      }
      throw new Error(`Groq request failed: ${detail}`);
    }
    const data = (await res.json()) as ChatCompletionResponse;
    const choice = data.choices?.[0];
    return {
      content: choice?.message?.content ?? "",
      stopReason: choice?.finish_reason ?? "stop",
      tokenUsage: {
        input: data.usage?.prompt_tokens ?? 0,
        output: data.usage?.completion_tokens ?? 0,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
