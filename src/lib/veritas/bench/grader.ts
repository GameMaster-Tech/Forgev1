/**
 * ForgeBench-Reason — grader.
 *
 * Every grader function is PURE: given a task + response, produce a grade
 * with per-criterion scores. No I/O, no randomness — the same inputs yield
 * the same grade on every run.
 *
 * Thresholds are tuned conservatively: `passed` flips true only when the
 * aggregate score crosses the suite-specific pass bar AND there are no hard
 * failures (malformed response, fabrication signal, hallucinated citation).
 */

import type {
  AbstentionResponse,
  AbstentionTask,
  BenchCriterionScore,
  BenchGrade,
  BenchResponse,
  BenchSuiteId,
  BenchSuiteSummary,
  BenchTask,
  CitationResponse,
  CitationTask,
  ContraDetectResponse,
  ContraDetectTask,
  ConversationResponse,
  ConversationTask,
  MemoryRecallResponse,
  MemoryRecallTask,
  ReasoningChainResponse,
  ReasoningChainTask,
  BenchDifficulty,
} from "./types";

/* ─────────────────────────────────────────────────────────────
 *  Pass thresholds
 * ──────────────────────────────────────────────────────────── */

const PASS_THRESHOLDS: Record<BenchSuiteId, number> = {
  "contra-detect": 0.75,
  "memory-recall": 0.7,
  "reasoning-chain": 0.7,
  conversation: 0.65,
  citation: 0.95,       // citations are effectively all-or-nothing
  abstention: 0.9,      // fabrication penalty is high
};

/* ─────────────────────────────────────────────────────────────
 *  Entry point
 * ──────────────────────────────────────────────────────────── */

export function gradeTask(task: BenchTask, response: BenchResponse): BenchGrade {
  if (task.suite !== response.suite) {
    return malformed(task, `suite mismatch: expected ${task.suite}, got ${response.suite}`);
  }

  switch (task.suite) {
    case "contra-detect":
      return gradeContraDetect(task, response as ContraDetectResponse);
    case "memory-recall":
      return gradeMemoryRecall(task, response as MemoryRecallResponse);
    case "reasoning-chain":
      return gradeReasoningChain(task, response as ReasoningChainResponse);
    case "conversation":
      return gradeConversation(task, response as ConversationResponse);
    case "citation":
      return gradeCitation(task, response as CitationResponse);
    case "abstention":
      return gradeAbstention(task, response as AbstentionResponse);
    default: {
      // Exhaustive check — if a new suite is added and not handled, TS flags it.
      const _never: never = task;
      return malformed(_never as BenchTask, "unhandled suite");
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 *  Per-suite graders
 * ──────────────────────────────────────────────────────────── */

function gradeContraDetect(task: ContraDetectTask, resp: ContraDetectResponse): BenchGrade {
  const goldSet = new Set(task.expected.pairs.map(canonicalPairKey));
  const decoySet = new Set(task.expected.decoys.map(canonicalPairKey));
  const flaggedSet = new Set(resp.flaggedPairs.map(canonicalPairKey));

  let truePositives = 0;
  let falsePositives = 0;
  let decoyHits = 0;
  for (const f of flaggedSet) {
    if (goldSet.has(f)) truePositives++;
    else if (decoySet.has(f)) {
      falsePositives++;
      decoyHits++;
    } else {
      falsePositives++;
    }
  }

  const recall = goldSet.size === 0 ? 1 : truePositives / goldSet.size;
  const precision = flaggedSet.size === 0
    ? (goldSet.size === 0 ? 1 : 0)
    : truePositives / flaggedSet.size;
  const decoyResistance = decoySet.size === 0
    ? 1
    : 1 - decoyHits / decoySet.size;

  const f1 = harmonic(precision, recall);
  const aggregate = clamp01(0.5 * f1 + 0.5 * decoyResistance);

  const criteria: BenchCriterionScore[] = [
    { name: "recall", score: recall, detail: `${truePositives}/${goldSet.size} gold pairs found` },
    { name: "precision", score: precision, detail: `${truePositives}/${flaggedSet.size} flagged are gold` },
    { name: "decoy-resistance", score: decoyResistance, detail: `${decoyHits}/${decoySet.size} decoys wrongly flagged` },
  ];

  return finalise(task, aggregate, criteria, falsePositives > 0 && truePositives === 0);
}

function gradeMemoryRecall(task: MemoryRecallTask, resp: MemoryRecallResponse): BenchGrade {
  const goldClaims = new Set(task.expected.mustRecallClaimIds);
  const citedClaims = new Set(resp.citedClaimIds);
  let claimHits = 0;
  for (const id of goldClaims) if (citedClaims.has(id)) claimHits++;
  const claimRecall = goldClaims.size === 0 ? 1 : claimHits / goldClaims.size;

  let episodeRecall = 1;
  if (task.expected.mustRecallEpisodeIds && task.expected.mustRecallEpisodeIds.length > 0) {
    const goldEps = new Set(task.expected.mustRecallEpisodeIds);
    const cited = new Set(resp.citedEpisodeIds ?? []);
    let hits = 0;
    for (const id of goldEps) if (cited.has(id)) hits++;
    episodeRecall = goldEps.size === 0 ? 1 : hits / goldEps.size;
  }

  // Small bonus for mentioning claim content in the answer itself, not just listing ids.
  const answerCoverage = answerMentionsClaims(resp.answer, task, goldClaims);

  const aggregate = clamp01(0.55 * claimRecall + 0.25 * episodeRecall + 0.2 * answerCoverage);

  const criteria: BenchCriterionScore[] = [
    { name: "claim-recall", score: claimRecall, detail: `${claimHits}/${goldClaims.size} required claims cited` },
    { name: "episode-recall", score: episodeRecall },
    { name: "answer-coverage", score: answerCoverage, detail: "fraction of gold claims referenced in prose" },
  ];

  return finalise(task, aggregate, criteria, false);
}

function gradeReasoningChain(
  task: ReasoningChainTask,
  resp: ReasoningChainResponse,
): BenchGrade {
  const goldSupport = new Set(task.expected.supportingClaimIds);
  const used = new Set(resp.usedClaimIds);
  let hits = 0;
  for (const id of goldSupport) if (used.has(id)) hits++;

  const support = goldSupport.size === 0 ? 1 : hits / goldSupport.size;
  const chainLengthOk = used.size >= task.expected.minChainLength ? 1 : used.size / task.expected.minChainLength;

  const answerScore = normaliseAnswerSimilarity(resp.answer, task.expected.finalAnswer);

  const aggregate = clamp01(0.4 * support + 0.2 * chainLengthOk + 0.4 * answerScore);

  const criteria: BenchCriterionScore[] = [
    { name: "support-coverage", score: support, detail: `${hits}/${goldSupport.size} supporting claims used` },
    { name: "chain-length", score: chainLengthOk, detail: `${used.size} used / ${task.expected.minChainLength} required` },
    { name: "answer-similarity", score: answerScore, detail: "normalised match to gold conclusion" },
  ];

  return finalise(task, aggregate, criteria, false);
}

function gradeConversation(task: ConversationTask, resp: ConversationResponse): BenchGrade {
  const answerLower = resp.answer.toLowerCase();

  // Tone points — for each cue, check if it shows up in the answer.
  const toneHits = task.expected.tonePoints.filter((t) => matchTonePoint(answerLower, t)).length;
  const toneScore = task.expected.tonePoints.length === 0
    ? 1
    : toneHits / task.expected.tonePoints.length;

  // Reference claims — answer should mention them by id OR paraphrase.
  const refIds = task.expected.referenceClaimIds;
  const cited = new Set(resp.citedClaimIds ?? []);
  let refHits = 0;
  for (const id of refIds) {
    if (cited.has(id)) refHits++;
    else if (answerLower.includes(id.toLowerCase())) refHits++;
  }
  const refScore = refIds.length === 0 ? 1 : refHits / refIds.length;

  // Length discipline
  const lengthScore = lengthOk(resp.answer, task.expected.maxTokens);

  const aggregate = clamp01(0.45 * toneScore + 0.35 * refScore + 0.2 * lengthScore);

  const criteria: BenchCriterionScore[] = [
    { name: "tone", score: toneScore, detail: `${toneHits}/${task.expected.tonePoints.length} tone points` },
    { name: "reference-coverage", score: refScore, detail: `${refHits}/${refIds.length} references` },
    { name: "length-discipline", score: lengthScore },
  ];

  return finalise(task, aggregate, criteria, false);
}

function gradeCitation(task: CitationTask, resp: CitationResponse): BenchGrade {
  const given = resp.doi.trim().toLowerCase();
  const gold = task.expected.doi.trim().toLowerCase();
  const alts = (task.expected.acceptedAlternates ?? []).map((d) => d.trim().toLowerCase());

  const exactMatch = given === gold;
  const altMatch = alts.includes(given);
  const match = exactMatch || altMatch;

  const aggregate = match ? 1 : 0;
  const criteria: BenchCriterionScore[] = [
    { name: "exact-match", score: exactMatch ? 1 : 0 },
    { name: "alternate-match", score: altMatch ? 1 : 0 },
  ];

  return finalise(task, aggregate, criteria, false);
}

function gradeAbstention(task: AbstentionTask, resp: AbstentionResponse): BenchGrade {
  const answerLower = resp.answer.toLowerCase();
  const hasAbstentionCue = task.expected.abstentionCues.some((c) => answerLower.includes(c.toLowerCase()));
  const fabricationCues = task.expected.fabricationCues ?? [];
  const hasFabricationCue = fabricationCues.some((c) => answerLower.includes(c.toLowerCase()));

  const abstentionFlag = resp.abstained ? 1 : 0;
  const cueScore = hasAbstentionCue ? 1 : 0;
  const cleanScore = hasFabricationCue ? 0 : 1;

  const aggregate = clamp01(0.5 * abstentionFlag + 0.3 * cueScore + 0.2 * cleanScore);

  const criteria: BenchCriterionScore[] = [
    { name: "abstained-flag", score: abstentionFlag },
    { name: "abstention-language", score: cueScore },
    { name: "no-fabrication", score: cleanScore, detail: hasFabricationCue ? "fabrication cue detected" : "clean" },
  ];

  return finalise(task, aggregate, criteria, hasFabricationCue);
}

/* ─────────────────────────────────────────────────────────────
 *  Shared helpers
 * ──────────────────────────────────────────────────────────── */

function canonicalPairKey(pair: [string, string]): string {
  const [a, b] = pair;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function answerMentionsClaims(
  answer: string,
  task: MemoryRecallTask,
  goldClaimIds: Set<string>,
): number {
  if (goldClaimIds.size === 0) return 1;
  const claimTextById = new Map<string, string>();
  for (const c of task.context.claims) claimTextById.set(c.id, c.atomicAssertion.toLowerCase());

  const answerLower = answer.toLowerCase();
  let hits = 0;
  for (const id of goldClaimIds) {
    const text = claimTextById.get(id);
    if (!text) continue;
    const head = text.split(/\s+/).slice(0, 5).join(" ");
    if (head.length >= 10 && answerLower.includes(head)) hits++;
  }
  return hits / goldClaimIds.size;
}

function normaliseAnswerSimilarity(candidate: string, gold: string): number {
  const a = tokenise(candidate);
  const b = tokenise(gold);
  if (a.length === 0 || b.length === 0) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

const STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "in", "is", "it", "its", "of", "on", "or", "that", "the", "to", "was", "were",
  "with", "this", "these", "those", "we", "our", "their", "they", "them",
]);

function tokenise(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

function matchTonePoint(answerLower: string, point: string): boolean {
  // Synthetic tone checks keyed by convention.
  switch (point) {
    case "concise":
      return answerLower.length <= 800;
    case "no-jargon":
      return !/\b(heretofore|henceforth|aforementioned|pursuant)\b/.test(answerLower);
    case "cites-sources":
      return /doi:|\(20\d{2}\)|et al\./.test(answerLower);
    case "hedges-appropriately":
      return /\b(may|might|suggests|appears|likely)\b/.test(answerLower);
    default:
      // Fallback: treat as a substring requirement.
      return answerLower.includes(point.toLowerCase());
  }
}

function lengthOk(answer: string, maxTokens?: number): number {
  if (!maxTokens) return 1;
  const estimated = Math.ceil(answer.length / 4); // rough tokens estimate
  if (estimated <= maxTokens) return 1;
  if (estimated <= maxTokens * 1.25) return 0.7;
  if (estimated <= maxTokens * 1.5) return 0.4;
  return 0;
}

function harmonic(a: number, b: number): number {
  if (a === 0 && b === 0) return 0;
  return (2 * a * b) / (a + b);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function finalise(
  task: BenchTask,
  aggregate: number,
  criteria: BenchCriterionScore[],
  hardFail: boolean,
): BenchGrade {
  const threshold = PASS_THRESHOLDS[task.suite];
  return {
    taskId: task.id,
    suite: task.suite,
    score: aggregate,
    passed: !hardFail && aggregate >= threshold,
    criteria,
    malformed: false,
  };
}

function malformed(task: BenchTask, detail: string): BenchGrade {
  return {
    taskId: task.id,
    suite: task.suite,
    score: 0,
    passed: false,
    criteria: [{ name: "response-shape", score: 0, detail }],
    malformed: true,
  };
}

/* ─────────────────────────────────────────────────────────────
 *  Suite / run aggregators
 * ──────────────────────────────────────────────────────────── */

export function summariseSuite(
  suite: BenchSuiteId,
  grades: BenchGrade[],
  tasks: BenchTask[],
): BenchSuiteSummary {
  const mine = grades.filter((g) => g.suite === suite);
  const taskById = new Map(tasks.map((t) => [t.id, t]));

  const zeroBucket = (): { n: number; passed: number; avg: number } =>
    ({ n: 0, passed: 0, avg: 0 });

  const byDifficulty: Record<BenchDifficulty, { n: number; passed: number; avg: number }> = {
    easy: zeroBucket(),
    medium: zeroBucket(),
    hard: zeroBucket(),
  };

  let totalScore = 0;
  let passCount = 0;
  for (const g of mine) {
    totalScore += g.score;
    if (g.passed) passCount++;
    const t = taskById.get(g.taskId);
    const d: BenchDifficulty = t?.difficulty ?? "medium";
    byDifficulty[d].n += 1;
    byDifficulty[d].avg += g.score;
    if (g.passed) byDifficulty[d].passed += 1;
  }
  for (const d of ["easy", "medium", "hard"] as BenchDifficulty[]) {
    const b = byDifficulty[d];
    b.avg = b.n === 0 ? 0 : b.avg / b.n;
  }

  return {
    suite,
    taskCount: mine.length,
    passCount,
    avgScore: mine.length === 0 ? 0 : totalScore / mine.length,
    byDifficulty,
  };
}
