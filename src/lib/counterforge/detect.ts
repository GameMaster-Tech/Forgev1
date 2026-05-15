/**
 * Counterforge — the skeptic engine.
 *
 * Three pure-ish functions:
 *
 *   extractLoadBearingClaims(text)
 *       Pulls sentences that look like declarative claims with at
 *       least one quantifier / hedge / definite assertion. Heuristic
 *       on purpose — claim extraction quality matters less than counter
 *       quality, because the user can dismiss noise in one tap.
 *
 *   findCounterEvidence(claim, corpus)
 *       Polarity-flipped retrieval over the project's snippets +
 *       claims. We look for sources that:
 *         • directly contradict (negation markers, opposing polarity)
 *         • qualify (limit scope, replicate failure, sample size)
 *         • dispute the underlying assumption
 *
 *   synthesiseCounterArgument(claim, evidence)
 *       Builds the 2-3 sentence counter-case. Deterministic template
 *       today (so users get something usable without an LLM round-
 *       trip); designed to be swapped for a Veritas-R1 call when
 *       that pipeline lights up.
 */

import type { CounterEvidence, CounterStrength } from "./types";

/* ── Inputs ─────────────────────────────────────────────────── */

export interface ClaimRow {
  id: string;
  atomicAssertion: string;
  text?: string;
  polarity?: "positive" | "negative";
  sourceSupport?: string;
  retired?: boolean;
}

export interface SnippetRow {
  id: string;
  text: string;
  origin?: string;
  sourceRef?: string;
}

export interface DocSection {
  documentId: string;
  paragraphIdx: number;
  text: string;
}

/* ── 1. Claim extraction ───────────────────────────────────── */

const HEDGE_WORDS = new Set([
  "may","might","could","possibly","perhaps","likely","probably","suggests","appears",
]);

const STRONG_MARKERS = [
  /\b(is|are|was|were)\s+\w+/i,           // copular assertion
  /\b(shows?|demonstrates?|proves?|implies?|establishes?|confirms?)\b/i,
  /\b(\d+(?:\.\d+)?\s?%|\d+(?:\.\d+)?-fold|\bp\s?<\s?0\.\d+)/i, // quantitative
  /\b(always|never|all|none|every|only)\b/i, // universal quantifier
];

const NEGATION_MARKERS = /\b(not|never|no longer|fails to|cannot|does not|doesn't|didn't)\b/i;

/**
 * Heuristic claim extractor. Splits text into sentences, returns only
 * those that look load-bearing (have at least one strong marker AND
 * no hedge that softens the whole sentence into "maybe").
 */
export function extractLoadBearingClaims(text: string): string[] {
  if (!text) return [];
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 30 && s.length <= 360)
    .filter((s) => !s.endsWith("?"));

  const out: string[] = [];
  for (const s of sentences) {
    const tokens = s.toLowerCase().split(/\W+/);
    // Skip sentences dominated by hedges.
    const hedgeCount = tokens.filter((t) => HEDGE_WORDS.has(t)).length;
    if (hedgeCount >= 2) continue;
    const strong = STRONG_MARKERS.some((re) => re.test(s));
    if (!strong) continue;
    out.push(s);
  }
  return out;
}

/* ── 2. Counter-evidence retrieval ──────────────────────────── */

const STOPWORDS = new Set([
  "the","a","an","and","or","but","if","then","of","on","in","to","for","with",
  "is","are","was","were","be","been","being","this","that","these","those",
  "as","at","by","from","into","over","under","about","through","after","before",
  "it","its","they","them","their","our","we","you","your","i","my","me","he","she",
]);

function contentTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !STOPWORDS.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

const QUALIFIER_PATTERNS = [
  /\b(small sample|underpowered|low statistical power)\b/i,
  /\b(failed to replicate|replication failure|not replicated)\b/i,
  /\b(meta-analysis|systematic review)\b/i,
  /\b(confounded|confounder|spurious|reverse causation)\b/i,
  /\b(retracted|retraction|errata|erratum)\b/i,
];

/**
 * Score a candidate snippet/claim as counter-evidence for a target claim.
 * Returns 0 if it doesn't qualify as a counter. The score combines:
 *   • topic overlap (Jaccard on content tokens)
 *   • negation alignment (one polarity-flipped, the other not)
 *   • qualifier-pattern hits (replication failure, small-N, retraction…)
 */
export function scoreAsCounter(
  claimText: string,
  candidateText: string,
): number {
  const claimNeg = NEGATION_MARKERS.test(claimText);
  const candNeg = NEGATION_MARKERS.test(candidateText);
  const polarityFlip = claimNeg !== candNeg;

  const overlap = jaccard(contentTokens(claimText), contentTokens(candidateText));
  if (overlap < 0.10) return 0;

  let score = overlap * 0.6;
  if (polarityFlip) score += 0.25;

  for (const re of QUALIFIER_PATTERNS) {
    if (re.test(candidateText)) {
      score += 0.10;
      break; // count once
    }
  }
  return Math.min(1, score);
}

export interface CounterCandidate {
  text: string;
  sourceRef?: string;
  kind: CounterEvidence["kind"];
  score: number;
}

export function findCounterEvidence(input: {
  claimText: string;
  snippets: ReadonlyArray<SnippetRow>;
  claims: ReadonlyArray<ClaimRow>;
  documents?: ReadonlyArray<DocSection>;
  maxPerCase?: number;
}): CounterCandidate[] {
  const max = input.maxPerCase ?? 5;
  const out: CounterCandidate[] = [];

  for (const c of input.claims) {
    if (c.retired) continue;
    const text = c.atomicAssertion || c.text || "";
    if (!text) continue;
    const score = scoreAsCounter(input.claimText, text);
    if (score === 0) continue;
    out.push({ text, sourceRef: c.id, kind: "claim", score });
  }
  for (const s of input.snippets) {
    const score = scoreAsCounter(input.claimText, s.text);
    if (score === 0) continue;
    out.push({ text: s.text, sourceRef: s.sourceRef ?? s.id, kind: "snippet", score });
  }
  for (const sec of input.documents ?? []) {
    const score = scoreAsCounter(input.claimText, sec.text);
    if (score === 0) continue;
    out.push({
      text: sec.text,
      sourceRef: `${sec.documentId}#p${sec.paragraphIdx}`,
      kind: "document",
      score,
    });
  }

  out.sort((a, b) => b.score - a.score);
  return out.slice(0, max);
}

/* ── 3. Counter-argument synthesis ─────────────────────────── */

/**
 * Build a 2-3 sentence counter-argument from the top evidence.
 *
 * Template-driven so we don't block on an LLM round-trip. The output
 * is deliberately concise; UI shows the full evidence rows alongside.
 *
 * When/if Veritas-R1 is wired in, swap this body for an LLM call —
 * the inputs and return shape stay identical.
 */
export function synthesiseCounterArgument(
  claimText: string,
  evidence: ReadonlyArray<CounterCandidate>,
): { argument: string; strength: CounterStrength } {
  if (evidence.length === 0) {
    return { argument: "", strength: "weak" };
  }

  const topScore = evidence[0].score;
  const strength: CounterStrength =
    topScore >= 0.65 ? "strong" : topScore >= 0.40 ? "moderate" : "weak";

  const lead =
    strength === "strong"
      ? "A reviewer could push back on this. "
      : strength === "moderate"
        ? "There's a credible counter to consider. "
        : "A weaker but worth-noting counter exists. ";

  const opening = scaffoldOpening(claimText);
  const evidenceLine = evidence
    .slice(0, 2)
    .map((e) => `"${trim(e.text, 140)}"`)
    .join(" — and — ");
  const close =
    strength === "strong"
      ? "Addressing this before submission is worth the time."
      : "It may not block the claim, but reviewers will notice if unaddressed.";

  const argument = `${lead}${opening} ${evidenceLine}. ${close}`;
  return { argument, strength };
}

function scaffoldOpening(claimText: string): string {
  if (/\b(\d+(?:\.\d+)?\s?%|\d+-fold|p\s?<\s?0\.\d+)/i.test(claimText)) {
    return "The numeric strength of this claim is exposed when contrasted with:";
  }
  if (/\b(always|never|all|none|every|only)\b/i.test(claimText)) {
    return "The universal scope of this claim invites the question of exceptions, such as:";
  }
  if (NEGATION_MARKERS.test(claimText)) {
    return "The denial in this claim is testable; consider:";
  }
  return "The claim runs against evidence such as:";
}

/* ── helpers ─────────────────────────────────────────────────── */

function trim(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

/**
 * Deterministic fingerprint for dedup. Same claim canonical form →
 * same fingerprint, regardless of whitespace/casing differences.
 */
export function fingerprintClaim(projectId: string, claimText: string): string {
  const canonical = claimText
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  let h = 0x811c9dc5;
  const s = `${projectId}|${canonical}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
