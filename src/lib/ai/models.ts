/**
 * Chat model config — single model, no mode/model selector.
 *
 * The multi-model roster (Qwen, GPT-OSS-120B) and the Standard/Thinking/
 * Reasoning mode toggle were removed: premium/reasoning models are a cost
 * we can't justify pre-funding, and the picker was unused complexity. The
 * whole app now runs on one fast, cheap model.
 */

/** The single production chat model — fast + inexpensive. */
export const CHAT_MODEL = "llama-3.1-8b-instant";
export const CHAT_MAX_TOKENS = 1200;

export interface ChatModelConfig {
  model: string;
  maxCompletionTokens: number;
}

/** Resolve the chat model config. `GROQ_MODEL` env can override the id. */
export function chatModelConfig(): ChatModelConfig {
  return {
    model: process.env.GROQ_MODEL?.trim() || CHAT_MODEL,
    maxCompletionTokens: CHAT_MAX_TOKENS,
  };
}
