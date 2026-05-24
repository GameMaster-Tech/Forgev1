/**
 * Agent loop — multi-turn tool-calling driver for Groq.
 *
 * The loop:
 *   1. Send conversation + tools to Groq.
 *   2. If the model returned a final assistant message (no tool_calls),
 *      return it.
 *   3. If the model returned tool_calls, execute each one in parallel
 *      via the registry, append the assistant turn + one tool turn
 *      per call to the transcript, and loop.
 *   4. Bail with the last assistant message after `maxTurns` to
 *      prevent runaway loops (typical scheduler runs in 2–4 turns).
 *
 * Always logs each turn so you can watch the agent work in `next dev`.
 *
 * Returns the final assistant text + the full transcript + a step
 * list (one entry per tool invocation) so the UI can show "what the
 * agent did" alongside its answer.
 */

import "server-only";
import { DEFAULT_MODEL, groqChat, GroqApiError, type ChatMessage } from "@/lib/ai/groq";
import type { BuiltRegistry } from "./tools/registry";
import type { ToolContext } from "./tools/types";

export interface AgentStep {
  turn: number;
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  durationMs: number;
}

export interface AgentRunResult {
  /** Final user-facing message from the assistant after the loop ended. */
  message: string;
  /** Every tool the model invoked, in order. */
  steps: AgentStep[];
  /** Full chat transcript (system + user + tool turns) — handy for debugging. */
  transcript: ChatMessage[];
  /** Why the loop stopped: "complete" (model returned plain text) | "max-turns" | "error". */
  finishReason: "complete" | "max-turns" | "error";
  /** Aggregated Groq usage. */
  tokens: { input: number; output: number; total: number };
  model: string;
  durationMs: number;
}

export interface RunAgentOptions {
  system: string;
  /** First user instruction (and anything else seeding the conversation). */
  messages: ChatMessage[];
  registry: BuiltRegistry;
  ctx: ToolContext;
  model?: string;
  maxTurns?: number;
  temperature?: number;
  /** How long each individual Groq call may take. */
  perCallTimeoutMs?: number;
}

const DEFAULT_MAX_TURNS = 6;

export async function runAgent(opts: RunAgentOptions): Promise<AgentRunResult> {
  const {
    system,
    messages,
    registry,
    ctx,
    model = DEFAULT_MODEL,
    maxTurns = DEFAULT_MAX_TURNS,
    temperature = 0.3,
    perCallTimeoutMs = 30_000,
  } = opts;

  const transcript: ChatMessage[] = [...messages];
  const steps: AgentStep[] = [];
  const tokens = { input: 0, output: 0, total: 0 };
  const t0 = Date.now();
  let finalMessage = "";
  let finishReason: AgentRunResult["finishReason"] = "max-turns";

  for (let turn = 1; turn <= maxTurns; turn++) {
    console.log(
      `[agent] turn ${turn}/${maxTurns} transcript=${transcript.length} tools=${registry.definitions.length}`,
    );

    let result;
    try {
      result = await groqChat({
        model,
        system,
        messages: transcript,
        tools: registry.definitions,
        toolChoice: "auto",
        temperature,
        maxCompletionTokens: 2_000,
        timeoutMs: perCallTimeoutMs,
      });
    } catch (err) {
      const detail =
        err instanceof GroqApiError
          ? `${err.status} — ${err.detail ?? err.message}`
          : err instanceof Error
            ? err.message
            : "unknown";
      console.error(`[agent] ✗ Groq call failed on turn ${turn}: ${detail}`);
      finishReason = "error";
      finalMessage = `Agent stopped: ${detail}`;
      break;
    }

    tokens.input += result.tokenUsage.input;
    tokens.output += result.tokenUsage.output;
    tokens.total += result.tokenUsage.total;

    // No tool calls → this is the final answer.
    if (!result.toolCalls || result.toolCalls.length === 0) {
      finalMessage = result.content.trim();
      transcript.push({ role: "assistant", content: finalMessage });
      finishReason = "complete";
      console.log(`[agent] ✓ complete in ${turn} turn${turn === 1 ? "" : "s"} contentChars=${finalMessage.length}`);
      break;
    }

    // Append the assistant turn (with tool_calls) before any tool turns.
    transcript.push({
      role: "assistant",
      content: result.content ?? "",
      tool_calls: result.toolCalls,
    });

    // Execute every tool call in parallel — they're independent
    // server-side mutations / reads.
    const dispatches = result.toolCalls.map(async (call) => {
      const name = call.function?.name ?? "(unknown)";
      let args: Record<string, unknown> = {};
      try {
        args = call.function?.arguments
          ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
          : {};
      } catch (err) {
        const detail = err instanceof Error ? err.message : "invalid JSON";
        const errPayload = { error: `Could not parse arguments for ${name}: ${detail}` };
        return {
          call,
          name,
          args,
          payload: errPayload,
          durationMs: 0,
        };
      }
      const stepStart = Date.now();
      const payload = await registry.dispatch(name, args, ctx);
      const durationMs = Date.now() - stepStart;
      console.log(
        `[agent]   tool ${name} → ${durationMs}ms ${typeof payload === "object" && payload && "error" in (payload as object) ? "ERROR" : "ok"}`,
      );
      return { call, name, args, payload, durationMs };
    });

    const settled = await Promise.all(dispatches);

    for (const { call, name, args, payload, durationMs } of settled) {
      steps.push({ turn, tool: name, args, result: payload, durationMs });
      transcript.push({
        role: "tool",
        tool_call_id: call.id,
        name,
        content: safeStringify(payload),
      });
    }
  }

  if (finishReason === "max-turns") {
    finalMessage = finalMessage || "Stopped after max turns without a final answer.";
    console.warn(`[agent] ⚠ max turns reached (${maxTurns})`);
  }

  return {
    message: finalMessage,
    steps,
    transcript,
    finishReason,
    tokens,
    model,
    durationMs: Date.now() - t0,
  };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
