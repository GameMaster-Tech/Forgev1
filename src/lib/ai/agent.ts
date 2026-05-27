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

/**
 * Live agent event — surfaced to the UI while the loop is running so
 * the user sees the model think instead of staring at a spinner.
 *
 *   • thinking    — between turns; "drafting…", "deciding what to read…"
 *   • tool_start  — a tool call assembled and is about to execute
 *   • tool_done   — a tool returned with a short summary
 *   • final       — the agent emitted its final text answer
 *   • error       — the loop bailed
 *
 * Each event carries the structured payload the UI needs to render
 * a per-tool chip (e.g. for `research_search`: the query string and,
 * after completion, the top URLs being "read").
 */
export type AgentEvent =
  | { kind: "thinking"; turn: number; text: string }
  | {
      kind: "tool_start";
      turn: number;
      tool: string;
      args: Record<string, unknown>;
      label: string;
      /** When the tool is research_search/answer, this carries the
       * verbatim query for display. */
      query?: string;
    }
  | {
      kind: "tool_done";
      turn: number;
      tool: string;
      durationMs: number;
      label: string;
      /** Top URLs returned by web tools — UI surfaces them as the
       * "currently browsing" chip strip. */
      sources?: { url: string; title?: string }[];
      /** Compact numeric summary the UI can show in a chip
       * ("4 docs", "12 events", "2 results"). */
      summary?: string;
    }
  | {
      /** Token-level delta of the final assistant message. Fires only
       * when the model is producing its final answer (no more tool
       * calls) — the UI appends the text to the assistant turn's
       * content as it arrives. */
      kind: "delta";
      text: string;
    }
  | {
      kind: "final";
      message: string;
      tokens: { input: number; output: number; total: number };
      model: string;
      durationMs: number;
      finishReason: "complete" | "max-turns" | "error";
    }
  | { kind: "error"; message: string };

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
  /** Live event stream — invoked synchronously while the loop runs. */
  onEvent?: (event: AgentEvent) => void;
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
    onEvent,
  } = opts;
  const emit = (e: AgentEvent) => {
    try {
      onEvent?.(e);
    } catch (err) {
      // Don't let UI errors take down the agent loop.
      console.warn("[agent] onEvent throw:", err instanceof Error ? err.message : err);
    }
  };

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
    emit({
      kind: "thinking",
      turn,
      text:
        turn === 1
          ? "Thinking through what you asked…"
          : "Deciding what to do next…",
    });

    // Heuristic: only stream tokens when we believe THIS turn will
    // produce the final answer. The model can still emit tool_calls
    // in a streamed response (we handle that), but most turns that
    // start with content are final. Always streaming would still
    // work — this just avoids a tiny extra payload for tool turns.
    const isLikelyFinalTurn = turn > 1;

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
        onDelta: isLikelyFinalTurn
          ? (text) => emit({ kind: "delta", text })
          : undefined,
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
      emit({ kind: "error", message: detail });
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
        emit({
          kind: "tool_done",
          turn,
          tool: name,
          durationMs: 0,
          label: `Couldn't parse ${name} arguments`,
        });
        return {
          call,
          name,
          args,
          payload: errPayload,
          durationMs: 0,
        };
      }
      // Live "what I'm doing right now" event — UI shows it as a chip.
      emit({
        kind: "tool_start",
        turn,
        tool: name,
        args,
        label: humanLabelForStart(name, args),
        query: typeof args.query === "string" ? args.query : typeof args.question === "string" ? args.question : undefined,
      });
      const stepStart = Date.now();
      const payload = await registry.dispatch(name, args, ctx);
      const durationMs = Date.now() - stepStart;
      console.log(
        `[agent]   tool ${name} → ${durationMs}ms ${typeof payload === "object" && payload && "error" in (payload as object) ? "ERROR" : "ok"}`,
      );
      // Live "I'm done with that step" event — carries the URLs the
      // model is about to read (web tools) or a numeric summary.
      const { sources, summary } = summarizePayload(name, payload);
      emit({
        kind: "tool_done",
        turn,
        tool: name,
        durationMs,
        label: humanLabelForDone(name, payload),
        sources,
        summary,
      });
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

  const totalMs = Date.now() - t0;
  emit({
    kind: "final",
    message: finalMessage,
    tokens,
    model,
    durationMs: totalMs,
    finishReason,
  });

  return {
    message: finalMessage,
    steps,
    transcript,
    finishReason,
    tokens,
    model,
    durationMs: totalMs,
  };
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/* ─────────────────── human-readable per-tool labels ─────────────────── */

/**
 * Mapping from `function.name` to a verb-led, in-progress phrase the
 * user sees as a thinking chip. Diversified by tool so the chat reads
 * like a colleague narrating their work, not a robot pinging endpoints.
 *
 * Each phrase fits the pattern: "<verb -ing> + <noun>" so the UI can
 * prefix a spinner and the result reads naturally:
 *
 *   • "Searching the web for 'q3 hiring benchmarks'…"
 *   • "Reading your doc 'Roadmap H2'…"
 *   • "Checking your calendar (May 14 → May 21)…"
 */
function humanLabelForStart(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "docs_list":
      return "Looking through your docs";
    case "docs_read": {
      const docId = typeof args.docId === "string" ? args.docId : "";
      const tail = docId ? ` (${docId.slice(0, 6)}…)` : "";
      return `Reading your doc${tail}`;
    }
    case "docs_create":
      return `Drafting a new doc: "${trunc(args.title)}"`;
    case "docs_update":
      return `Updating a doc: "${trunc(args.title) || "in-place edit"}"`;
    case "research_search": {
      const q = typeof args.query === "string" ? args.query : "";
      return q ? `Searching the web for "${trunc(q, 60)}"` : "Searching the web";
    }
    case "research_answer": {
      const q = typeof args.question === "string" ? args.question : "";
      return q ? `Asking the web: "${trunc(q, 60)}"` : "Asking the web";
    }
    case "calendar_list_events": {
      const start = isoToShort(args.start);
      const end = isoToShort(args.end);
      return start && end
        ? `Checking your calendar (${start} → ${end})`
        : "Checking your calendar";
    }
    case "calendar_create_event":
      return `Scheduling "${trunc(args.title)}"`;
    case "calendar_update_event":
      return "Moving an event";
    case "calendar_delete_event":
      return "Cancelling an event";
    case "tasks_list":
      return "Looking through your tasks";
    case "tasks_create":
      return `Creating a task: "${trunc(args.title)}"`;
    case "habits_create":
      return `Creating a habit: "${trunc(args.title)}"`;
    case "goals_create":
      return `Creating a goal: "${trunc(args.title)}"`;
    default:
      return `Calling ${name}`;
  }
}

/**
 * Once a tool returns, generate the past-tense phrase the UI swaps in.
 * Numeric counts get included where they matter ("Read 4 docs",
 * "Got 6 results"). Failed calls surface a compact error label.
 */
function humanLabelForDone(name: string, payload: unknown): string {
  if (isErr(payload)) return `${name} failed`;
  switch (name) {
    case "docs_list":
      return `Found ${countOf(payload, "docs")} doc${countOf(payload, "docs") === 1 ? "" : "s"}`;
    case "docs_read": {
      const title =
        (payload as { title?: string }).title ?? "the doc";
      return `Read "${trunc(title, 60)}"`;
    }
    case "docs_create":
      return "Created the doc";
    case "docs_update":
      return "Updated the doc";
    case "research_search":
      return `Found ${countOf(payload, "results")} web result${countOf(payload, "results") === 1 ? "" : "s"}`;
    case "research_answer":
      return "Synthesized an answer";
    case "calendar_list_events":
      return `Found ${countOf(payload, "events")} event${countOf(payload, "events") === 1 ? "" : "s"}`;
    case "calendar_create_event":
      return "Scheduled it";
    case "calendar_update_event":
      return "Moved it";
    case "calendar_delete_event":
      return "Cancelled it";
    case "tasks_list":
      return `Found ${countOf(payload, "tasks")} task${countOf(payload, "tasks") === 1 ? "" : "s"}`;
    case "tasks_create":
      return "Created the task";
    case "habits_create":
      return "Created the habit";
    case "goals_create":
      return "Created the goal";
    default:
      return `${name} done`;
  }
}

/**
 * Extract the top URLs from a web-tool payload so the UI can render a
 * "Currently browsing…" chip strip with real source domains. Falls
 * through for non-web tools.
 */
function summarizePayload(
  name: string,
  payload: unknown,
): { sources?: { url: string; title?: string }[]; summary?: string } {
  if (isErr(payload)) return {};
  if (name === "research_search") {
    const results = (payload as { results?: Array<{ url?: string; title?: string | null }> }).results ?? [];
    const sources = results
      .slice(0, 4)
      .map((r) => ({ url: r.url ?? "", title: r.title ?? undefined }))
      .filter((s) => s.url);
    return { sources, summary: `${results.length} result${results.length === 1 ? "" : "s"}` };
  }
  if (name === "research_answer") {
    const srcs = (payload as { sources?: Array<{ url?: string; title?: string | null }> }).sources ?? [];
    const sources = srcs
      .slice(0, 4)
      .map((r) => ({ url: r.url ?? "", title: r.title ?? undefined }))
      .filter((s) => s.url);
    return { sources, summary: `${srcs.length} source${srcs.length === 1 ? "" : "s"}` };
  }
  if (name === "docs_list") {
    return { summary: `${countOf(payload, "docs")} docs` };
  }
  if (name === "calendar_list_events") {
    return { summary: `${countOf(payload, "events")} events` };
  }
  if (name === "tasks_list") {
    return { summary: `${countOf(payload, "tasks")} tasks` };
  }
  return {};
}

function isErr(payload: unknown): boolean {
  return typeof payload === "object" && payload !== null && "error" in (payload as object);
}

function countOf(payload: unknown, key: string): number {
  if (typeof payload !== "object" || payload === null) return 0;
  const arr = (payload as Record<string, unknown>)[key];
  if (Array.isArray(arr)) return arr.length;
  const explicitCount = (payload as Record<string, unknown>).count;
  return typeof explicitCount === "number" ? explicitCount : 0;
}

function trunc(v: unknown, n = 40): string {
  if (typeof v !== "string") return "";
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
}

function isoToShort(v: unknown): string {
  if (typeof v !== "string") return "";
  try {
    const d = new Date(v);
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}
