/**
 * Qwen3 chat-template adapter — bidirectional, production-grade.
 *
 * What this file does
 * ───────────────────
 * Translates between Forge's structured `ThoughtTrace.steps` (the schema we
 * persist on every `Episode`) and Qwen3's chat-template message format (the
 * shape `tokenizer.apply_chat_template` consumes during training and emits
 * during inference).
 *
 * Why the seam matters
 * ────────────────────
 * The training pipeline (CP6 SFT, CP9 GRPO, CP11 DPO) packs real Forge
 * episodes into Qwen3 chat messages. The serving path (CP13/14) parses
 * Qwen3 outputs back into ThoughtTrace so they can be persisted on the
 * Episode. **Both directions must be lossless for what the model actually
 * emits at inference** — anything else means the model is trained on a
 * distribution it can't faithfully reproduce, or vice versa.
 *
 * Format choices — and why they match GPT-5 / Claude / o-series exactly
 * ────────────────────────────────────────────────────────────────────
 *   • `reasoning_content` is **plain natural-language prose**. No prefix
 *     syntax, no markup, no embedded structure. This matches:
 *       - OpenAI Responses API: `reasoning.summary` is prose; structure
 *         lives in `tool_calls`.
 *       - Claude content blocks: `thinking` blocks are prose; structure
 *         lives in `tool_use` blocks.
 *       - DeepSeek-R1's `<think>…</think>`: prose.
 *       - Qwen3's pretraining distribution: prose.
 *     A v1 of this file used a `think: …\nrecall: claims=…` prefix syntax —
 *     that was a mistake. It (a) burns 15-25% extra tokens, (b) doesn't match
 *     Qwen3's pretraining distribution, (c) creates a train/serve mismatch
 *     because the model never emits prefix lines at inference.
 *
 *   • Memory recall is a **first-class tool call** (`memory_recall`), not
 *     embedded markup. The model invokes it like any other tool; the tool
 *     response carries the `claims` and `episodes` ids. This is the same
 *     pattern OpenAI uses for `web_search`, Claude uses for `tool_use`, and
 *     it's how Veritas-R1 will actually behave at inference (CP14 wires the
 *     tool definition into vLLM).
 *
 *   • Tool calls follow the OpenAI shape exactly: `tool_calls: [{ id,
 *     type:"function", function: { name, arguments: <JSON-string> } }]`.
 *     vLLM, SGLang, TRL's chat-template loader all read this verbatim.
 *
 * Round-trip contract
 * ───────────────────
 * For every trace `T` that Veritas-R1 produces at inference (kinds:
 * `think | recall | retrieve | verify | tool-call | answer`),
 *      `chatMLToTrace(traceToChatML(T)) == T`
 * modulo step-index renumbering (we always reassign 0..N on output).
 *
 * Schema fields with no inference-time signal — `decide` step kind and
 * `confidence` numbers — are **lossy on the wire format by design**. They
 * are UI annotations for human-authored steps; the model never emits them.
 * `decide` collapses to `think`; `confidence` is dropped. Both fields stay
 * on the schema for internal use (UI, training-data sampling, audit).
 *
 * What this file does NOT do
 * ──────────────────────────
 *   • String-level rendering with `<|im_start|>` markers — that's the
 *     tokenizer's job, performed Python-side via `apply_chat_template`. We
 *     stop at the structured message array.
 *   • Function-call argument validation — the trainer assumes tool inputs
 *     are valid JSON; if a real episode has malformed JSON, the trace
 *     should have been rejected before persistence.
 */

import type { ThoughtStep, ThoughtTrace } from "../memory/schema";

/* ─────────────────────────────────────────────────────────────
 *  Message types — match the OpenAI / Qwen3 chat shape exactly
 * ──────────────────────────────────────────────────────────── */

/** A single tool call emitted by the assistant. `arguments` is a JSON string
 *  to mirror the OpenAI shape exactly — Qwen3 / vLLM / TRL all expect this. */
export interface ChatToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * Roles understood by Qwen3's chat template. `tool` carries function-call
 * results; `assistant` may carry both reasoning and final content.
 */
export type ChatRole = "system" | "user" | "assistant" | "tool";

/** Discriminated message union — keeps each role's required fields obvious. */
export type ChatMessage =
  | SystemMessage
  | UserMessage
  | AssistantMessage
  | ToolMessage;

export interface SystemMessage {
  role: "system";
  content: string;
}

export interface UserMessage {
  role: "user";
  content: string;
}

export interface AssistantMessage {
  role: "assistant";
  /**
   * Final answer text shown to the user. May be empty when this assistant
   * turn only emits tool calls and no answer yet — Qwen3 supports that.
   */
  content: string;
  /**
   * Qwen3-native field for the `<think>…</think>` block. **Plain prose.**
   * Empty or absent when the assistant turn has no reasoning content
   * (lightning mode or pure tool-call turns).
   */
  reasoning_content?: string;
  /**
   * Tool calls the assistant is requesting — surfaces as one or more
   * `<tool_call>{...}</tool_call>` blocks at template-render time.
   */
  tool_calls?: ChatToolCall[];
}

export interface ToolMessage {
  role: "tool";
  /** JSON-stringified tool result. The schema's `toolOutput` is encoded here. */
  content: string;
  /** Matches the `id` of the originating assistant `ChatToolCall`. */
  tool_call_id: string;
  /** Name of the tool, mirrored from the originating call. */
  name?: string;
}

/* ─────────────────────────────────────────────────────────────
 *  Tool-name canon — first-class tools that map onto schema kinds.
 *  The CP14 vLLM serving config wires these tools into the system
 *  prompt; the trainer sees them in CP3/CP6 datasets. Keeping the
 *  names centralised here is the single source of truth.
 * ──────────────────────────────────────────────────────────── */

export const TOOL_NAMES = {
  /** Pull claim / episode ids from project memory. Replaces the v1 `recall:` prefix. */
  memoryRecall: "memory_recall",
  /** External retrieval (Crossref / OpenAlex / arXiv / PubMed). */
  retrieve: "retrieve",
  /** DOI verification — does this paper exist and support the claim? */
  verify: "verify_citation",
} as const;

/* ─────────────────────────────────────────────────────────────
 *  Conversion options
 * ──────────────────────────────────────────────────────────── */

/**
 * Inputs the converter cannot recover from the trace alone.
 *   • `userInput` is the prompt that triggered the trace — stored on
 *     `Episode.input`, not on the trace itself.
 *   • `systemPrompt` is the system preamble used at run time. Defaults to
 *     a minimal verification-first prompt; production wires the same
 *     string Veritas-R1 was trained with (Phase 3 will pin one).
 *   • `mode` selects between Forge UI tiers; `lightning` skips the
 *     reasoning_content emission entirely so chat-mode training data
 *     never carries a stray reasoning block.
 */
export interface TraceToChatMLOptions {
  userInput: string;
  systemPrompt?: string;
  mode?: "lightning" | "reasoning" | "deep";
}

const DEFAULT_SYSTEM_PROMPT =
  "You are Veritas-R1, Forge's verification-first research assistant. " +
  "Ground every answer in the provided claims, episodes, and contradictions. " +
  "Prefer abstention to fabrication when evidence is insufficient.";

/* ─────────────────────────────────────────────────────────────
 *  ThoughtTrace  →  Chat messages
 * ──────────────────────────────────────────────────────────── */

/**
 * Convert a `ThoughtTrace` plus its triggering user input into the structured
 * message array Qwen3's tokenizer consumes.
 *
 * Step-by-step encoding
 * ─────────────────────
 *   • `think` / `decide`  →  contributes a paragraph to `reasoning_content`
 *                            on the next emitted assistant turn. `decide`
 *                            collapses to plain prose (lossy on wire).
 *   • `recall`            →  emits a `memory_recall` tool call + tool-result
 *                            message. Lossless: claim/episode ids round-trip
 *                            through the tool result payload.
 *   • `retrieve`          →  emits a `retrieve` tool call + result.
 *   • `verify`            →  emits a `verify_citation` tool call + result.
 *   • `tool-call`         →  emits a generic tool call using `step.tool` as
 *                            the function name + result.
 *   • `answer`            →  flushes the buffered reasoning into the open
 *                            assistant turn's `reasoning_content` and writes
 *                            its text into `content`.
 *
 * Tool-call ids are deterministic (`tc-0`, `tc-1`, …) so identical traces
 * produce identical message arrays — required for dataset deduplication at
 * training time (CP5).
 */
export function traceToChatML(
  trace: ThoughtTrace,
  opts: TraceToChatMLOptions,
): ChatMessage[] {
  const messages: ChatMessage[] = [
    { role: "system", content: opts.systemPrompt ?? DEFAULT_SYSTEM_PROMPT },
    { role: "user", content: opts.userInput },
  ];

  // In `lightning` mode we strip everything except the answer — chat-mode
  // training data must never carry stray reasoning.
  const stripReasoning = opts.mode === "lightning";

  // Accumulator for the current open assistant turn — flushed on each tool
  // call or on the final answer. Each entry is one paragraph of prose.
  let reasoningBuffer: string[] = [];

  // Walk steps in their declared `index` order. We don't trust insertion
  // order — the schema defines `index` as the canonical sequence.
  const steps = [...trace.steps].sort((a, b) => a.index - b.index);

  let toolCallCounter = 0;

  const flushAssistant = (
    finalContent: string,
    toolCall?: ChatToolCall,
  ): void => {
    const assistant: AssistantMessage = {
      role: "assistant",
      content: finalContent,
    };
    if (!stripReasoning && reasoningBuffer.length > 0) {
      assistant.reasoning_content = reasoningBuffer.join("\n\n");
    }
    if (toolCall) {
      assistant.tool_calls = [toolCall];
    }
    messages.push(assistant);
    reasoningBuffer = [];
  };

  for (const step of steps) {
    switch (step.kind) {
      case "think":
      case "decide": {
        // Both kinds collapse to plain prose. `decide` is a UI-only annotation
        // for human-authored traces; the trained model never emits it.
        if (stripReasoning) break;
        const text = step.text?.trim();
        if (text) reasoningBuffer.push(text);
        break;
      }
      case "recall": {
        // First-class memory_recall tool call. Replaces v1 prefix syntax.
        const id = `tc-${toolCallCounter++}`;
        const tc: ChatToolCall = {
          id,
          type: "function",
          function: {
            name: TOOL_NAMES.memoryRecall,
            // `arguments` carries the recall query (empty when the schema
            // step doesn't have one — which is fine, the tool returns the
            // ids regardless and the model reads them from the result).
            arguments: jsonStringify({ query: step.text ?? "" }),
          },
        };
        flushAssistant("", tc);
        messages.push({
          role: "tool",
          tool_call_id: id,
          name: TOOL_NAMES.memoryRecall,
          content: jsonStringify({
            claims: step.recalledClaims ?? [],
            episodes: step.recalledEpisodes ?? [],
          }),
        });
        break;
      }
      case "retrieve":
      case "verify":
      case "tool-call": {
        const id = `tc-${toolCallCounter++}`;
        const name = step.tool ?? canonicalToolName(step.kind);
        const tc: ChatToolCall = {
          id,
          type: "function",
          function: {
            name,
            arguments: jsonStringify(step.toolInput),
          },
        };
        flushAssistant("", tc);
        messages.push({
          role: "tool",
          tool_call_id: id,
          name,
          content: jsonStringify(step.toolOutput),
        });
        break;
      }
      case "answer": {
        flushAssistant(step.text ?? "");
        break;
      }
    }
  }

  // Trailing reasoning without a closing answer — emit the assistant turn
  // anyway so the round-trip recovers it. Empty content + reasoning is a
  // valid intermediate state for streamed generations.
  if (reasoningBuffer.length > 0) {
    flushAssistant("");
  }

  return messages;
}

function canonicalToolName(
  kind: "retrieve" | "verify" | "tool-call",
): string {
  if (kind === "retrieve") return TOOL_NAMES.retrieve;
  if (kind === "verify") return TOOL_NAMES.verify;
  return "tool";
}

/* ─────────────────────────────────────────────────────────────
 *  Chat messages  →  ThoughtTrace
 * ──────────────────────────────────────────────────────────── */

/**
 * Reverse of `traceToChatML`. Skips the system + user messages — the trace
 * begins at the first assistant turn.
 *
 * Round-trip guarantee
 * ────────────────────
 * For every trace produced by Veritas-R1 (no `decide` kind, no `confidence`),
 *      `chatMLToTrace(traceToChatML(T)) == T`
 * modulo step-index renumbering (always 0..N on output).
 *
 * For human-authored traces with `decide` / `confidence`, those fields are
 * lost — see the file header.
 */
export function chatMLToTrace(messages: ChatMessage[]): ThoughtTrace {
  const steps: ThoughtStep[] = [];
  let index = 0;

  // Index tool-result messages by their `tool_call_id` for O(1) pairing.
  const toolResultByCallId = new Map<string, ToolMessage>();
  for (const m of messages) {
    if (m.role === "tool") toolResultByCallId.set(m.tool_call_id, m);
  }

  for (const m of messages) {
    if (m.role !== "assistant") continue;

    // 1. Reasoning prose → one `think` step per double-newline-separated
    //    paragraph. We use blank-line separation (encoded as "\n\n" on the
    //    way out) so multi-paragraph thoughts don't collapse into one blob.
    if (m.reasoning_content) {
      const paragraphs = m.reasoning_content
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      for (const p of paragraphs) {
        steps.push({ kind: "think", text: p, index });
        index++;
      }
    }

    // 2. Tool calls → step kind based on tool name. `memory_recall` is
    //    decoded back to a `recall` step; everything else maps via name.
    if (m.tool_calls) {
      for (const tc of m.tool_calls) {
        const result = toolResultByCallId.get(tc.id);
        const parsedOutput = result ? jsonParseSafe(result.content) : undefined;

        if (tc.function.name === TOOL_NAMES.memoryRecall) {
          // Special-case decode of memory_recall — claim/episode ids live
          // in the tool result payload, not the call. Recover the query
          // text from the call arguments so `step.text` survives round-trip
          // when one was supplied (otherwise the recall step is anonymous).
          const out = (parsedOutput ?? {}) as {
            claims?: unknown;
            episodes?: unknown;
          };
          const recalledClaims = stringArray(out.claims);
          const recalledEpisodes = stringArray(out.episodes);
          const args = jsonParseSafe(tc.function.arguments);
          let queryText: string | undefined;
          if (args && typeof args === "object") {
            const q = (args as { query?: unknown }).query;
            if (typeof q === "string" && q.length > 0) queryText = q;
          }
          const step: ThoughtStep = { kind: "recall", index };
          if (queryText) step.text = queryText;
          if (recalledClaims.length) step.recalledClaims = recalledClaims;
          if (recalledEpisodes.length) step.recalledEpisodes = recalledEpisodes;
          steps.push(step);
          index++;
          continue;
        }

        const kind = canonicaliseToolKind(tc.function.name);
        const step: ThoughtStep = {
          kind,
          index,
          tool: tc.function.name,
          toolInput: jsonParseSafe(tc.function.arguments),
          toolOutput: parsedOutput,
        };
        steps.push(step);
        index++;
      }
    }

    // 3. Final answer — only if non-empty. Empty content on a tool-bearing
    //    turn is structural, not a real answer step.
    if (m.content && m.content.length > 0) {
      steps.push({ kind: "answer", text: m.content, index });
      index++;
    }
  }

  return { steps };
}

/**
 * Map a tool name back to the schema's three tool-bearing kinds. Veritas-R1's
 * default tool surface uses `retrieve` / `verify_citation` / generic; other
 * names fall back to the catch-all `tool-call` kind so the model can call
 * arbitrary tools defined per-deployment without breaking the parser.
 */
function canonicaliseToolKind(
  name: string,
): "retrieve" | "verify" | "tool-call" {
  if (name === TOOL_NAMES.retrieve) return "retrieve";
  if (name === TOOL_NAMES.verify) return "verify";
  // Heuristic for retrieval-flavoured tool names — keeps the schema kind
  // faithful even when the model emits a more specific name.
  if (/verify|doi/i.test(name)) return "verify";
  if (/retrieve|search|crossref|openalex|arxiv|pubmed/i.test(name)) {
    return "retrieve";
  }
  return "tool-call";
}

/* ─────────────────────────────────────────────────────────────
 *  Tiny JSON helpers — never throw; always emit a deterministic
 *  string. Determinism matters because identical traces must
 *  produce identical message arrays for dataset dedup at training.
 * ──────────────────────────────────────────────────────────── */

function jsonStringify(value: unknown): string {
  if (value === undefined) return "{}";
  try {
    return JSON.stringify(value);
  } catch {
    return "{}";
  }
}

function jsonParseSafe(s: string): unknown {
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s; // surface the raw string rather than silently dropping data
  }
}

function stringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) if (typeof x === "string") out.push(x);
  return out;
}
