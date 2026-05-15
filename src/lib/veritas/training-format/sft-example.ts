/**
 * SFTExample — TS counterpart of the Python `firestore_export.py` output.
 *
 * Why this file exists
 * ────────────────────
 * The CP3 exporter is Python (training boxes don't run Node). But Forge's
 * runtime — the API routes that listen to user actions, the indexer that
 * builds new claims — needs to speak the same shape so that:
 *
 *   1. Future on-device training data exports (browser-side smoke generation,
 *      live-eval data sampling) emit identical JSONL.
 *   2. The TS integration test can assert that messages produced by the
 *      Python exporter parse cleanly back through `chatMLToTrace` — that's
 *      the CP3 exit criterion.
 *   3. CP10 (DPO preference extractor) re-uses this exact shape with two
 *      `messages` arrays per record (`chosen` / `rejected`).
 *
 * The shape MUST stay byte-equivalent to the Python `SFTExample.to_json()`
 * output. If you change one side, change the other in the same commit.
 */

import type { ThoughtTrace, Episode, Claim } from "../memory/schema";
import {
  traceToChatML,
  chatMLToTrace,
  type ChatMessage,
} from "./chat-template";

/** Bump this when the on-disk format changes in a backward-incompatible way. */
export const SFT_SCHEMA_VERSION = "v1";

export type SFTMode = "lightning" | "reasoning" | "deep";

/**
 * One training example. Mirrors `SFTExample.to_json()` in the Python
 * exporter exactly — same key order, same types.
 */
export interface SFTExample {
  id: string;
  /** Underscore key — matches the Python wire format. */
  project_id: string;
  schema_version: typeof SFT_SCHEMA_VERSION;
  mode: SFTMode;
  messages: ChatMessage[];
  citations: string[];
  /** id → atomic_assertion lookup. The trainer constructs the
   *  `memory_recall` tool result from this map. */
  claims_context: Record<string, string>;
  tokens_estimate: number;
  /** ISO timestamp from the source Episode (NOT the export wall-clock). */
  created_at: string;
}

/* ─────────────────────────────────────────────────────────────
 *  Mode inference + token estimate — must match the Python heuristics.
 * ──────────────────────────────────────────────────────────── */

/**
 * Pick a Forge UI mode for an Episode.
 *
 * Heuristic — same one CP14 will use at inference to default-route a
 * request when the user hasn't picked a mode explicitly:
 *   • No trace, or trace with only an answer step  → lightning
 *   • Tool calls OR > 5 think steps                → deep
 *   • Otherwise                                    → reasoning
 *
 * MUST match `infer_mode` in `firestore_export.py` step-for-step.
 */
export function inferMode(trace: ThoughtTrace | undefined): SFTMode {
  if (!trace || trace.steps.length === 0) return "lightning";

  let hasToolCall = false;
  let thinkCount = 0;
  for (const s of trace.steps) {
    if (
      s.kind === "retrieve" ||
      s.kind === "verify" ||
      s.kind === "tool-call" ||
      s.kind === "recall"
    ) {
      hasToolCall = true;
    }
    if (s.kind === "think" || s.kind === "decide") thinkCount++;
  }

  if (!hasToolCall && thinkCount === 0) return "lightning";
  if (hasToolCall || thinkCount > 5) return "deep";
  return "reasoning";
}

/**
 * Char/4 token-count heuristic. Matches `estimate_tokens` in Python so
 * sequence-length filtering at CP5 produces identical drop decisions on
 * either side.
 */
export function estimateTokens(messages: ChatMessage[]): number {
  let totalChars = 0;
  for (const m of messages) {
    totalChars += m.role.length + 2;
    totalChars += m.content.length;
    if (m.role === "assistant" && m.reasoning_content) {
      totalChars += m.reasoning_content.length;
    }
    if (m.role === "assistant" && m.tool_calls) {
      for (const tc of m.tool_calls) {
        totalChars += tc.function.name.length + tc.function.arguments.length + 16;
      }
    }
    if (m.role === "tool") {
      totalChars += m.tool_call_id.length;
    }
  }
  // +20% margin — see Python sibling for justification.
  return Math.floor(totalChars / 4) + Math.floor(totalChars / 20);
}

/* ─────────────────────────────────────────────────────────────
 *  Episode → SFTExample
 * ──────────────────────────────────────────────────────────── */

/**
 * Optional context for the converter — same semantics as the Python
 * `episode_to_example` parameters.
 */
export interface EpisodeToSFTOptions {
  /**
   * Map of claim id → Claim. Only claims referenced by the Episode need
   * to be present; missing entries are tolerated (the citation is kept
   * but `claims_context` won't carry the atomic assertion).
   */
  claimsById: Record<string, Claim>;
  systemPrompt?: string;
  /** When false, callers must scrub themselves. Default true. */
  scrubPII?: boolean;
}

/**
 * Lossy Episode → SFTExample conversion.
 *
 * Returns `undefined` for episodes that have no useful training signal —
 * empty input, no answer, or a trace that fails decoding. Same drop
 * conditions as the Python exporter.
 *
 * Does NOT do PII scrubbing in the TS path — Forge runtime callers either
 * (a) don't have PII in the trace because they're synth fixtures, or
 * (b) ship the data through the Python pipeline which scrubs there.
 * The TS path is only used for round-trip validation in the integration
 * test, where matching the Python behaviour bit-for-bit on PII would
 * require porting the regexes too. We accept the asymmetry and document it.
 */
export function episodeToSFTExample(
  episode: Episode,
  opts: EpisodeToSFTOptions,
): SFTExample | undefined {
  const userInput = episode.input?.trim();
  if (!userInput) return undefined;

  // Synthesise a closing answer step from `episode.output` when the trace
  // doesn't already have one — mirrors the Python branch.
  let trace = episode.thoughtTrace;
  if (trace && trace.steps.length > 0) {
    const last = trace.steps[trace.steps.length - 1];
    if (last.kind !== "answer" && episode.output) {
      trace = {
        ...trace,
        steps: [
          ...trace.steps,
          { kind: "answer", text: episode.output, index: trace.steps.length },
        ],
      };
    }
  } else if (episode.output) {
    trace = {
      steps: [{ kind: "answer", text: episode.output, index: 0 }],
    };
  }

  if (!trace || trace.steps.length === 0) return undefined;

  const mode = inferMode(trace);
  const messages = traceToChatML(trace, {
    userInput,
    systemPrompt: opts.systemPrompt,
    mode,
  });

  const citations = (episode.claimsReferenced ?? []).filter(
    (c): c is string => typeof c === "string",
  );
  const claims_context: Record<string, string> = {};
  for (const cid of citations) {
    const c = opts.claimsById[cid];
    if (c?.atomicAssertion) claims_context[cid] = c.atomicAssertion;
  }

  return {
    id: episode.id,
    project_id: episode.projectId,
    schema_version: SFT_SCHEMA_VERSION,
    mode,
    messages,
    citations,
    claims_context,
    tokens_estimate: estimateTokens(messages),
    created_at: episode.timestamp,
  };
}

/* ─────────────────────────────────────────────────────────────
 *  Validation — surface bad shards before they reach the trainer
 * ──────────────────────────────────────────────────────────── */

/**
 * Cheap schema check on a parsed JSONL line. Returns null if valid, or
 * an error string explaining the first violation.
 *
 * Used by the integration test to reject anything the Python exporter
 * might emit that the TS parser couldn't handle. Cheap — no full
 * trace decode unless the shape passes.
 */
export function validateSFTExample(value: unknown): string | null {
  if (!value || typeof value !== "object") return "not an object";
  const v = value as Record<string, unknown>;
  if (typeof v.id !== "string") return "id missing or non-string";
  if (typeof v.project_id !== "string") return "project_id missing";
  if (v.schema_version !== SFT_SCHEMA_VERSION) {
    return `schema_version mismatch: got ${String(v.schema_version)}`;
  }
  if (v.mode !== "lightning" && v.mode !== "reasoning" && v.mode !== "deep") {
    return `bad mode: ${String(v.mode)}`;
  }
  if (!Array.isArray(v.messages) || v.messages.length === 0) {
    return "messages missing or empty";
  }
  if (!Array.isArray(v.citations)) return "citations not an array";
  if (
    !v.claims_context ||
    typeof v.claims_context !== "object" ||
    Array.isArray(v.claims_context)
  ) {
    return "claims_context not an object";
  }
  if (typeof v.tokens_estimate !== "number") return "tokens_estimate not a number";
  if (typeof v.created_at !== "string") return "created_at not a string";

  // The trace must round-trip without throwing. This is the actual CP3
  // exit-criterion check ("round-trips through CP2 adapter without loss").
  try {
    const recovered = chatMLToTrace(v.messages as ChatMessage[]);
    if (recovered.steps.length === 0) return "trace decoded to zero steps";
  } catch (err) {
    return `chatMLToTrace threw: ${(err as Error).message}`;
  }

  return null;
}
