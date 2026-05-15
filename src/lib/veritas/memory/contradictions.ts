/**
 * Contradiction detection — heuristic baseline (schema v2).
 *
 * High-recall, low-precision detector that feeds a reranker (Veritas-R1 in
 * production; Claude Sonnet during data generation) for final judgement.
 *
 * Key v2 changes:
 *   • Uses `polarity` (asserts / negates / descriptive) instead of numeric
 *     stance — more expressive.
 *   • Uses structured `quantitative` payload for magnitude + direction checks.
 *   • Uses `scope` to SUPPRESS false-positive contradictions across populations,
 *     doses, settings, or time windows.
 *   • Emits `Contradiction` objects directly, with a `score` and `signals[]`
 *     so the graph can track lifecycle (open / resolved / dismissed).
 */

import type {
  Claim,
  Contradiction,
  ContradictionSignal,
  ClaimScope,
} from "./schema";
import type {
  ClaimGraph,
  NewContradictionInput,
} from "./claim-graph";

/* ─────────────────────────────────────────────────────────────
 *  Public API
 * ──────────────────────────────────────────────────────────── */

export interface ContradictionDetectorOptions {
  /** Lower bound on lexical similarity for a pair to be considered. */
  minSimilarity?: number;
  /** Maximum pairs returned per claim. */
  maxPerClaim?: number;
  /** If true, suppress pairs whose scopes clearly disagree. Default: true. */
  scopeAware?: boolean;
  /** Minimum aggregate score threshold for emission. */
  minScore?: number;
}

const DEFAULTS: Required<ContradictionDetectorOptions> = {
  minSimilarity: 0.45,
  maxPerClaim: 8,
  scopeAware: true,
  minScore: 0.35,
};

/**
 * Finds candidate contradictions inside the graph and returns them as
 * `NewContradictionInput` records. Callers typically pass each to
 * `graph.addContradiction(...)` to persist.
 */
export function detectContradictions(
  graph: ClaimGraph,
  opts: ContradictionDetectorOptions = {},
): NewContradictionInput[] {
  const options = { ...DEFAULTS, ...opts };
  const claims = graph.listClaims();
  const out: NewContradictionInput[] = [];

  for (let i = 0; i < claims.length; i++) {
    const a = claims[i];
    if (a.supersededBy) continue;

    let perClaim = 0;
    for (let j = i + 1; j < claims.length; j++) {
      const b = claims[j];
      if (b.supersededBy) continue;

      const similarity = cosineBag(a.atomicAssertion, b.atomicAssertion);
      if (similarity < options.minSimilarity) continue;

      if (options.scopeAware && scopesClearlyDisagree(a.scope, b.scope)) continue;

      const signals = signalsBetween(a, b);
      if (signals.length === 0) continue;

      const score = aggregate(similarity, signals, a, b);
      if (score < options.minScore) continue;

      out.push({
        projectId: a.projectId,
        a: a.id,
        b: b.id,
        detector: "heuristic",
        signals,
        score,
        status: "open",
      });

      perClaim++;
      if (perClaim >= options.maxPerClaim) break;
    }
  }

  out.sort((x, y) => y.score - x.score);
  return out;
}

/**
 * Convenience: detect contradictions AND persist them into the graph.
 * Returns the persisted `Contradiction` records.
 */
export function detectAndPersist(
  graph: ClaimGraph,
  opts?: ContradictionDetectorOptions,
): Contradiction[] {
  return detectContradictions(graph, opts).map((c) => graph.addContradiction(c));
}

/* ─────────────────────────────────────────────────────────────
 *  Signal checks
 * ──────────────────────────────────────────────────────────── */

function signalsBetween(a: Claim, b: Claim): ContradictionSignal[] {
  const signals: ContradictionSignal[] = [];

  if (oppositePolarity(a, b)) signals.push("opposite-polarity");
  if (hasNegationFlip(a.atomicAssertion, b.atomicAssertion)) signals.push("negation-flip");
  if (hasAntonymVerb(a.atomicAssertion, b.atomicAssertion)) signals.push("antonym-verb");
  if (hasDirectionReversal(a, b)) signals.push("direction-reversal");
  if (hasMagnitudeReversal(a, b)) signals.push("magnitude-reversal");
  if (scopesOverlapSharply(a.scope, b.scope)) signals.push("scope-overlap");

  return signals;
}

function oppositePolarity(a: Claim, b: Claim): boolean {
  return (
    (a.polarity === "asserts" && b.polarity === "negates") ||
    (a.polarity === "negates" && b.polarity === "asserts")
  );
}

const NEG_MARKERS = ["not", "no", "never", "without", "fail to", "failed to"];

function hasNegationFlip(x: string, y: string): boolean {
  const xl = x.toLowerCase();
  const yl = y.toLowerCase();
  const xn = NEG_MARKERS.some((m) => xl.includes(m));
  const yn = NEG_MARKERS.some((m) => yl.includes(m));
  return xn !== yn;
}

const VERB_ANTONYMS: Record<string, string[]> = {
  increase:  ["decrease", "reduce", "lower", "diminish"],
  decrease:  ["increase", "raise", "elevate", "boost"],
  reduce:    ["increase", "raise", "worsen"],
  improve:   ["worsen", "degrade", "impair"],
  worsen:    ["improve", "enhance"],
  accelerate:["slow", "decelerate"],
  inhibit:   ["promote", "induce", "activate"],
  promote:   ["inhibit", "suppress", "block"],
  support:   ["refute", "contradict"],
  confirm:   ["refute", "contradict", "overturn"],
};

/** Word-boundary regex cache — substring matching was triggering on fragments
 *  (e.g. `decrease` matched inside `decreased`, which is fine, but `raise`
 *  inside `raisers`). We use `\b(verb|verbed|verbs)\b` tolerating the common
 *  English inflections. */
const ANTONYM_RE_CACHE = new Map<string, RegExp>();
function verbRe(verb: string): RegExp {
  const cached = ANTONYM_RE_CACHE.get(verb);
  if (cached) return cached;
  // Match the base verb plus common -s / -ed / -d / -ing inflections.
  const re = new RegExp(`\\b${verb}(?:s|es|ed|d|ing)?\\b`, "i");
  ANTONYM_RE_CACHE.set(verb, re);
  return re;
}

function hasAntonymVerb(x: string, y: string): boolean {
  for (const [verb, antonyms] of Object.entries(VERB_ANTONYMS)) {
    if (verbRe(verb).test(x) && antonyms.some((a) => verbRe(a).test(y))) return true;
  }
  return false;
}

function hasDirectionReversal(a: Claim, b: Claim): boolean {
  const da = a.quantitative?.direction;
  const db = b.quantitative?.direction;
  if (!da || !db) return false;
  return (
    (da === "increase" && db === "decrease") ||
    (da === "decrease" && db === "increase")
  );
}

function hasMagnitudeReversal(a: Claim, b: Claim): boolean {
  const va = a.quantitative?.value;
  const vb = b.quantitative?.value;
  if (typeof va !== "number" || typeof vb !== "number") return false;
  if (va <= 0 || vb <= 0) return false;
  return Math.max(va, vb) / Math.min(va, vb) >= 2;
}

/* ─────────────────────────────────────────────────────────────
 *  Scope logic
 * ──────────────────────────────────────────────────────────── */

/**
 * Returns true iff the two scopes clearly point at DIFFERENT phenomena, in
 * which case the pair should NOT be treated as a contradiction.
 *
 * We only suppress when a hard axis disagrees (population, dose, setting,
 * region). A missing axis on either side is treated as "possibly compatible"
 * and therefore does NOT suppress.
 */
function scopesClearlyDisagree(a: ClaimScope, b: ClaimScope): boolean {
  if (a.population && b.population && !strEqualLoose(a.population, b.population)) return true;
  if (a.setting && b.setting && a.setting !== b.setting) return true;
  if (a.region && b.region && a.region !== b.region) return true;
  if (a.dose && b.dose && !strEqualLoose(a.dose, b.dose)) return true;
  return false;
}

/** Returns true iff both scopes explicitly overlap on at least one axis. */
function scopesOverlapSharply(a: ClaimScope, b: ClaimScope): boolean {
  return (
    (a.population !== undefined && b.population !== undefined && strEqualLoose(a.population, b.population)) ||
    (a.setting !== undefined && b.setting !== undefined && a.setting === b.setting) ||
    (a.intervention !== undefined && b.intervention !== undefined && a.intervention === b.intervention)
  );
}

function strEqualLoose(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

/* ─────────────────────────────────────────────────────────────
 *  Aggregate scoring
 * ──────────────────────────────────────────────────────────── */

function aggregate(
  similarity: number,
  signals: ContradictionSignal[],
  a: Claim,
  b: Claim,
): number {
  const base = similarity * 0.45;
  const signalBoost = Math.min(0.45, signals.length * 0.13);

  // Strong signals amplify further.
  let strong = 0;
  if (signals.includes("direction-reversal")) strong += 0.08;
  if (signals.includes("magnitude-reversal")) strong += 0.08;
  if (signals.includes("opposite-polarity")) strong += 0.05;
  if (signals.includes("scope-overlap")) strong += 0.05;

  // If either claim is unsourced / weak, down-weight — conflicting rumours
  // aren't high-value signal.
  const penalty = a.sourceSupport === "unsourced" || b.sourceSupport === "unsourced"
    ? -0.1
    : 0;

  return clamp01(base + signalBoost + strong + penalty);
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/* ─────────────────────────────────────────────────────────────
 *  Bag-of-words cosine (dependency-free, deterministic)
 * ──────────────────────────────────────────────────────────── */

function cosineBag(a: string, b: string): number {
  const va = vectorise(a);
  const vb = vectorise(b);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, n] of va) na += n * n;
  for (const [, n] of vb) nb += n * n;
  for (const [tok, n] of va) {
    const m = vb.get(tok);
    if (m) dot += n * m;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

const STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have",
  "in", "is", "it", "its", "of", "on", "or", "that", "the", "to", "was", "were",
  "with", "this", "these", "those", "we", "our", "their", "they", "them",
]);

function vectorise(s: string): Map<string, number> {
  const m = new Map<string, number>();
  const toks = s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP.has(t));
  for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
  return m;
}
