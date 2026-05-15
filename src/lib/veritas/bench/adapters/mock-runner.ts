/**
 * MockBenchRunner — deterministic, zero-network BenchRunner.
 *
 * Purpose: let CI exercise the full bench pipeline (runner → grader →
 * summariser) without hitting an actual model provider. Every suite gets a
 * hand-picked "answer shape" so the grader sees a well-formed response and
 * either passes or fails on purpose — never malforms.
 *
 * Modes:
 *   • "oracle"  — read the task's `expected` and return the answer that
 *                 would score 1.0. Useful for pipeline smoke tests.
 *   • "zero"    — always return the worst-legal answer (empty arrays,
 *                 fabricated DOI, non-abstention). Smoke-tests the grader's
 *                 failure paths.
 *   • "scripted"— per-task canned responses the caller supplies.
 *
 * The runner is pure-sync under the hood but returns Promise to honour the
 * BenchRunner interface.
 */

import type {
  AbstentionResponse,
  BenchResponse,
  BenchRunner,
  BenchTask,
  CitationResponse,
  ContraDetectResponse,
  ConversationResponse,
  MemoryRecallResponse,
  ReasoningChainResponse,
} from "../types";

export type MockMode = "oracle" | "zero" | "scripted";

export interface MockBenchRunnerOptions {
  modelId?: string;
  mode?: MockMode;
  /** Required when mode === "scripted". Keyed by task id. */
  scripted?: Record<string, BenchResponse>;
}

export class MockBenchRunner implements BenchRunner {
  readonly modelId: string;
  private readonly mode: MockMode;
  private readonly scripted: Record<string, BenchResponse>;

  constructor(opts: MockBenchRunnerOptions = {}) {
    this.modelId = opts.modelId ?? `mock-${opts.mode ?? "oracle"}`;
    this.mode = opts.mode ?? "oracle";
    this.scripted = opts.scripted ?? {};
  }

  async run(task: BenchTask): Promise<BenchResponse> {
    if (this.mode === "scripted") {
      const hit = this.scripted[task.id];
      if (!hit) {
        throw new Error(
          `MockBenchRunner(scripted): no scripted response for task "${task.id}"`,
        );
      }
      if (hit.suite !== task.suite) {
        throw new Error(
          `MockBenchRunner(scripted): scripted suite mismatch for task "${task.id}" ` +
            `(task=${task.suite}, response=${hit.suite})`,
        );
      }
      return hit;
    }

    if (this.mode === "oracle") return oracleResponse(task);
    return zeroResponse(task);
  }
}

/* ─────────────────────────────────────────────────────────────
 *  Oracle — returns the ideal, schema-complete response
 * ──────────────────────────────────────────────────────────── */

function oracleResponse(task: BenchTask): BenchResponse {
  switch (task.suite) {
    case "contra-detect": {
      const r: ContraDetectResponse = {
        suite: "contra-detect",
        flaggedPairs: task.expected.pairs.map(([a, b]) => [a, b]),
        rationales: Object.fromEntries(
          task.expected.pairs.map(([a, b]) => [
            `${a}|${b}`,
            "Direct contradiction at matched scope.",
          ]),
        ),
      };
      return r;
    }
    case "memory-recall": {
      const r: MemoryRecallResponse = {
        suite: "memory-recall",
        citedClaimIds: [...task.expected.mustRecallClaimIds],
        citedEpisodeIds: task.expected.mustRecallEpisodeIds
          ? [...task.expected.mustRecallEpisodeIds]
          : undefined,
        answer: buildRecallAnswer(task),
      };
      return r;
    }
    case "reasoning-chain": {
      const r: ReasoningChainResponse = {
        suite: "reasoning-chain",
        usedClaimIds: [...task.expected.supportingClaimIds],
        answer: task.expected.finalAnswer,
      };
      return r;
    }
    case "conversation": {
      const r: ConversationResponse = {
        suite: "conversation",
        answer: buildConversationAnswer(task),
        citedClaimIds: [...task.expected.referenceClaimIds],
      };
      return r;
    }
    case "citation": {
      const r: CitationResponse = {
        suite: "citation",
        doi: task.expected.doi.toLowerCase(),
      };
      return r;
    }
    case "abstention": {
      const r: AbstentionResponse = {
        suite: "abstention",
        abstained: true,
        answer:
          task.expected.abstentionCues[0] ??
          "I don't have sufficient evidence in the project memory to answer that.",
      };
      return r;
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 *  Zero — worst legal answer per suite (tests grader failures)
 * ──────────────────────────────────────────────────────────── */

function zeroResponse(task: BenchTask): BenchResponse {
  switch (task.suite) {
    case "contra-detect":
      return { suite: "contra-detect", flaggedPairs: [] };
    case "memory-recall":
      return {
        suite: "memory-recall",
        citedClaimIds: [],
        answer: "",
      };
    case "reasoning-chain":
      return {
        suite: "reasoning-chain",
        usedClaimIds: [],
        answer: "",
      };
    case "conversation":
      return {
        suite: "conversation",
        answer: "",
        citedClaimIds: [],
      };
    case "citation":
      return {
        suite: "citation",
        doi: "10.0000/fabricated",
      };
    case "abstention":
      return {
        suite: "abstention",
        abstained: false,
        answer: (task.expected.fabricationCues ?? ["A fabricated answer."])[0],
      };
  }
}

/* ─────────────────────────────────────────────────────────────
 *  Answer synthesisers (string bodies — grader is lenient on text)
 * ──────────────────────────────────────────────────────────── */

function buildRecallAnswer(task: BenchTask & { suite: "memory-recall" }): string {
  const ids = task.expected.mustRecallClaimIds;
  if (ids.length === 0) return "No prior claim is relevant.";
  return `Prior evidence: ${ids.map((id) => `[${id}]`).join(", ")}.`;
}

function buildConversationAnswer(
  task: BenchTask & { suite: "conversation" },
): string {
  const cues = task.expected.tonePoints.join(" · ");
  const cites = task.expected.referenceClaimIds
    .map((id) => `[${id}]`)
    .join(" ");
  return `Based on your project memory ${cites}. (${cues})`;
}
