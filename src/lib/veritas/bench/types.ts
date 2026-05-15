/**
 * ForgeBench-Reason — core types.
 *
 * ForgeBench-Reason is Forge's internal eval harness. It measures the six
 * capabilities that differentiate Veritas-R1 from general-purpose LLMs:
 *
 *   1. contra-detect     — spot contradictions across the project graph.
 *   2. memory-recall     — pull the right prior claim / episode from memory.
 *   3. reasoning-chain   — chain multiple claims into a multi-step conclusion.
 *   4. conversation      — natural research-chat turn-taking while grounded.
 *   5. citation          — attach the correct DOI to an assertion.
 *   6. abstention        — refuse to fabricate when evidence is insufficient.
 *
 * Tasks are authored as typed records so the grader can score mechanically.
 * The harness is deterministic — every run of the same model + task yields
 * the same grade (modulo model stochasticity) and every grade ships with
 * a per-criterion breakdown for error analysis.
 */

import type { Claim, Episode, Contradiction } from "../memory/schema";

/* ─────────────────────────────────────────────────────────────
 *  Primitives
 * ──────────────────────────────────────────────────────────── */

export type BenchSuiteId =
  | "contra-detect"
  | "memory-recall"
  | "reasoning-chain"
  | "conversation"
  | "citation"
  | "abstention";

export type BenchDifficulty = "easy" | "medium" | "hard";

/** Canonical context packet the model sees before answering. */
export interface BenchContext {
  /** Claims visible to the model at task time. Order is stable for replay. */
  claims: Claim[];
  /** Episodes the model can recall. Chronological, oldest first. */
  episodes: Episode[];
  /** Known contradictions in the graph. */
  contradictions: Contradiction[];
  /** Free-form user-visible project brief. */
  projectBrief?: string;
}

/* ─────────────────────────────────────────────────────────────
 *  Task variants — discriminated union by suite id
 * ──────────────────────────────────────────────────────────── */

interface BenchTaskBase {
  id: string;
  suite: BenchSuiteId;
  difficulty: BenchDifficulty;
  /** Human-readable one-liner for the dashboard. */
  title: string;
  /** The prompt the model is asked to respond to. */
  prompt: string;
  /** Project state the model is allowed to see. */
  context: BenchContext;
  /** Short rationale explaining WHY this task is in the suite. Authoring note. */
  authoringNote?: string;
}

export interface ContraDetectTask extends BenchTaskBase {
  suite: "contra-detect";
  expected: {
    /** Claim ids the model should flag as contradicting each other. */
    pairs: Array<[string, string]>;
    /** Pairs that LOOK contradictory but aren't — scope-disagreements. */
    decoys: Array<[string, string]>;
  };
}

export interface MemoryRecallTask extends BenchTaskBase {
  suite: "memory-recall";
  expected: {
    /** The claim ids the model must cite in its answer. */
    mustRecallClaimIds: string[];
    /** Episode ids the model should reference. Optional. */
    mustRecallEpisodeIds?: string[];
  };
}

export interface ReasoningChainTask extends BenchTaskBase {
  suite: "reasoning-chain";
  expected: {
    /** Every claim the correct reasoning chain relies on. */
    supportingClaimIds: string[];
    /** The final single-sentence conclusion, normalised. */
    finalAnswer: string;
    /** Minimum number of distinct claims the chain must touch. */
    minChainLength: number;
  };
}

export interface ConversationTask extends BenchTaskBase {
  suite: "conversation";
  expected: {
    /** Tone signals the answer must hit ("concise", "no-jargon", "cites-sources"). */
    tonePoints: string[];
    /** Claim ids the answer should reference. */
    referenceClaimIds: string[];
    /** Max token length — conversational answers should stay tight. */
    maxTokens?: number;
  };
}

export interface CitationTask extends BenchTaskBase {
  suite: "citation";
  expected: {
    /** Correct DOI, lowercased. */
    doi: string;
    /** Alternative DOIs accepted as equivalent (rare — e.g. preprint ↔ version-of-record). */
    acceptedAlternates?: string[];
  };
}

export interface AbstentionTask extends BenchTaskBase {
  suite: "abstention";
  expected: {
    /** The model MUST abstain. */
    mustAbstain: true;
    /** Phrases whose presence would indicate a correct abstention. */
    abstentionCues: string[];
    /** Phrases whose presence proves fabrication (fail signal). */
    fabricationCues?: string[];
  };
}

export type BenchTask =
  | ContraDetectTask
  | MemoryRecallTask
  | ReasoningChainTask
  | ConversationTask
  | CitationTask
  | AbstentionTask;

/* ─────────────────────────────────────────────────────────────
 *  Model response shape — each suite dictates its own shape
 * ──────────────────────────────────────────────────────────── */

export interface ContraDetectResponse {
  suite: "contra-detect";
  flaggedPairs: Array<[string, string]>;
  /** Optional per-pair rationale. */
  rationales?: Record<string, string>;
}

export interface MemoryRecallResponse {
  suite: "memory-recall";
  citedClaimIds: string[];
  citedEpisodeIds?: string[];
  answer: string;
}

export interface ReasoningChainResponse {
  suite: "reasoning-chain";
  usedClaimIds: string[];
  answer: string;
}

export interface ConversationResponse {
  suite: "conversation";
  answer: string;
  citedClaimIds?: string[];
}

export interface CitationResponse {
  suite: "citation";
  doi: string;
}

export interface AbstentionResponse {
  suite: "abstention";
  /** Whether the model refused to answer. */
  abstained: boolean;
  answer: string;
}

export type BenchResponse =
  | ContraDetectResponse
  | MemoryRecallResponse
  | ReasoningChainResponse
  | ConversationResponse
  | CitationResponse
  | AbstentionResponse;

/* ─────────────────────────────────────────────────────────────
 *  Grading output
 * ──────────────────────────────────────────────────────────── */

export interface BenchCriterionScore {
  /** "recall", "precision", "coverage", "tone-concise", ... */
  name: string;
  /** 0..1. */
  score: number;
  /** Short rationale. */
  detail?: string;
}

export interface BenchGrade {
  taskId: string;
  suite: BenchSuiteId;
  /** 0..1 aggregate. */
  score: number;
  /** Whether this counts as a pass for suite-level reporting. */
  passed: boolean;
  criteria: BenchCriterionScore[];
  /** True if the response shape didn't even match the suite contract. */
  malformed: boolean;
}

export interface BenchSuiteSummary {
  suite: BenchSuiteId;
  taskCount: number;
  passCount: number;
  avgScore: number;
  /** Per-difficulty breakdown. */
  byDifficulty: Record<BenchDifficulty, { n: number; passed: number; avg: number }>;
}

export interface BenchRun {
  /** Model id under test. */
  model: string;
  /** When the run started. */
  startedAt: string;
  /** When the run finished. */
  finishedAt?: string;
  grades: BenchGrade[];
  summaries: BenchSuiteSummary[];
  /** Overall aggregate across all suites. */
  overall: { taskCount: number; passCount: number; avgScore: number };
}

/* ─────────────────────────────────────────────────────────────
 *  Runtime contract — the thing a model adapter implements
 * ──────────────────────────────────────────────────────────── */

export interface BenchRunner {
  /** Model id label stored in results. */
  readonly modelId: string;
  /** Run a single task. Must return a response whose `suite` matches the task. */
  run(task: BenchTask): Promise<BenchResponse>;
}
