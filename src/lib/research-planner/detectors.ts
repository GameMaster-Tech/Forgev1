/**
 * Research Planner — gap detectors.
 *
 * Three deterministic detectors run over a project's existing
 * artefacts and emit suggestion candidates. Persistence + dedup
 * happens in `scan.ts`.
 *
 *   1. undersupported-claim  — claim.sourceSupport ∈ {unsourced, weak}
 *   2. underread-topic       — topic phrase appears in a document but
 *                              has thin claim/snippet coverage
 *   3. contradiction         — open contradiction in veritasContradictions
 *
 * Detectors are pure(-ish) functions of the inputs they receive — the
 * caller is responsible for fetching from Firestore. This keeps the
 * detection logic testable + reusable from background workers later.
 */

import type { SuggestionKind, Suggestion } from "./types";

/* ── Shared shapes (loose — we only depend on the fields we use) ─ */

export interface ClaimRow {
  id: string;
  projectId: string;
  atomicAssertion: string;
  text?: string;
  /** "unsourced" | "weak" | "moderate" | "strong" | "consensus" */
  sourceSupport?: string;
  retired?: boolean;
}

export interface ContradictionRow {
  id: string;
  projectId: string;
  a: string;
  b: string;
  status: string;
  score?: number;
}

export interface DocumentRow {
  id: string;
  projectId: string;
  title: string;
  content?: unknown;
  updatedAt?: number;
}

export interface SnippetRow {
  id: string;
  projectId: string;
  text: string;
}

export interface SuggestionCandidate {
  kind: SuggestionKind;
  title: string;
  rationale: string;
  proposedAction: string;
  fingerprint: string;
  refs: Suggestion["refs"];
  rawScore: number;
}

/* ── 1. undersupported-claim ─────────────────────────────────── */

/**
 * Active claims with `sourceSupport` of `unsourced` or `weak` become
 * suggestions to find more support. `consensus` and `strong` are
 * skipped. `moderate` is skipped unless the claim is quantitative —
 * numbers without two independent sources are worth flagging.
 */
export function detectUndersupportedClaims(
  claims: ReadonlyArray<ClaimRow>,
): SuggestionCandidate[] {
  const out: SuggestionCandidate[] = [];
  for (const c of claims) {
    if (c.retired) continue;
    const support = c.sourceSupport ?? "unsourced";
    if (support !== "unsourced" && support !== "weak") continue;

    const assertion = (c.atomicAssertion || c.text || "").trim();
    if (!assertion) continue;

    const rawScore =
      support === "unsourced" ? 0.85 : 0.65;

    out.push({
      kind: "undersupported-claim",
      title: trim(assertion, 90),
      rationale:
        support === "unsourced"
          ? "This claim has no sources backing it. Forge surfaces unsourced claims so they can be either confirmed or removed before they reach the final draft."
          : "This claim has only weak support. Strengthening it with a peer-reviewed or primary source closes a verification gap.",
      proposedAction: `Find supporting sources for: "${trim(assertion, 120)}"`,
      fingerprint: hash(`undersupported|${c.id}`),
      refs: { claimId: c.id, claimText: assertion },
      rawScore,
    });
  }
  return out;
}

/* ── 2. underread-topic ─────────────────────────────────────── */

const STOPWORDS = new Set([
  "the","a","an","and","or","but","if","then","of","on","in","to","for","with",
  "is","are","was","were","be","been","being","this","that","these","those",
  "as","at","by","from","into","over","under","about","through","after","before",
  "it","its","they","them","their","our","we","you","your","i","my","me","he","she",
  "his","her","do","does","did","done","have","has","had","not","no","so","such",
  "very","more","most","much","many","some","any","all","each","every","other",
  "than","also","just","only","than","there","here","what","which","who","whom",
  "when","where","why","how","can","could","should","would","may","might","will",
  "shall","one","two","three","first","second","third","new","old","good","bad",
  "research","study","paper","work","using","based","important","significant",
]);

const TOPIC_THIN_THRESHOLD = 3;       // ≤ this many evidence rows = thin
const TOPIC_MIN_OCCURRENCES = 2;      // require ≥ 2 doc mentions before surfacing
const TOPIC_MAX_SUGGESTIONS = 10;

/**
 * Extract candidate "topic phrases" from active document content,
 * then count how many claims/snippets/queries cover each. Topics
 * below the coverage threshold become suggestions.
 *
 * The phrase extractor is intentionally simple: capitalised n-grams
 * (Proper Noun-ish) + frequent lowercase bigrams that aren't stop-
 * dominated. We're not trying to compete with a real NER tagger —
 * we want suggestions that are *good enough that the user nods*,
 * with zero new infra.
 */
export function detectUnderreadTopics(input: {
  documents: ReadonlyArray<DocumentRow>;
  claims: ReadonlyArray<ClaimRow>;
  snippets: ReadonlyArray<SnippetRow>;
  queries?: ReadonlyArray<{ id: string; query?: string; answer?: string }>;
}): SuggestionCandidate[] {
  const docText = input.documents
    .map((d) => extractDocPlainText(d))
    .join("\n\n");
  if (!docText.trim()) return [];

  const topics = extractTopicPhrases(docText);

  // Build a single corpus blob to count coverage against.
  const corpus = (
    input.claims.map((c) => c.atomicAssertion || c.text || "").join(" ") +
    " " +
    input.snippets.map((s) => s.text).join(" ") +
    " " +
    (input.queries ?? [])
      .map((q) => `${q.query ?? ""} ${q.answer ?? ""}`)
      .join(" ")
  ).toLowerCase();

  const out: SuggestionCandidate[] = [];
  for (const [phrase, docCount] of topics) {
    if (docCount < TOPIC_MIN_OCCURRENCES) continue;
    const needle = phrase.toLowerCase();
    if (needle.length < 4) continue;
    const coverage = countOccurrences(corpus, needle);
    if (coverage > TOPIC_THIN_THRESHOLD) continue;

    // Score: higher when discussed often but covered thinly.
    const rawScore = clamp01(
      0.4 + 0.1 * Math.min(docCount, 6) - 0.1 * coverage,
    );

    out.push({
      kind: "underread-topic",
      title: `Thin coverage on "${phrase}"`,
      rationale: `You're writing about "${phrase}" (${docCount} mention${docCount === 1 ? "" : "s"} in your documents) but the project has ${coverage === 0 ? "no" : `only ${coverage}`} extracted claim${coverage === 1 ? "" : "s"} or snippet${coverage === 1 ? "" : "s"} on it. Reading deeper here will give the draft real ground to stand on.`,
      proposedAction: `Deep-read sources on "${phrase}"`,
      fingerprint: hash(`underread|${needle}`),
      refs: { topic: phrase },
      rawScore,
    });
  }
  out.sort((a, b) => b.rawScore - a.rawScore);
  return out.slice(0, TOPIC_MAX_SUGGESTIONS);
}

/* ── 3. contradiction ───────────────────────────────────────── */

export function detectContradictions(input: {
  contradictions: ReadonlyArray<ContradictionRow>;
  claimsById: ReadonlyMap<string, ClaimRow>;
}): SuggestionCandidate[] {
  const out: SuggestionCandidate[] = [];
  for (const c of input.contradictions) {
    if (c.status !== "open") continue;
    const a = input.claimsById.get(c.a);
    const b = input.claimsById.get(c.b);
    if (!a || !b) continue;

    const aText = a.atomicAssertion || a.text || "";
    const bText = b.atomicAssertion || b.text || "";

    out.push({
      kind: "contradiction",
      title: "Unresolved contradiction in the claim graph",
      rationale: `Two of your claims disagree:\n  • ${trim(aText, 140)}\n  • ${trim(bText, 140)}\n\nResolving this before drafting prevents the contradiction from leaking into the final write-up.`,
      proposedAction: `Resolve the contradiction between "${trim(aText, 70)}" and "${trim(bText, 70)}"`,
      fingerprint: hash(`contradiction|${c.id}`),
      refs: { claimId: c.a, claimText: aText, rivalClaimId: c.b },
      // Use the detector's own confidence if it provided one, else a
      // moderate default. Contradictions are high-value when real,
      // so even moderate confidence is worth surfacing.
      rawScore: clamp01(c.score ?? 0.7),
    });
  }
  return out;
}

/* ── Plain-text + topic-extraction helpers ───────────────────── */

function extractDocPlainText(d: DocumentRow): string {
  if (!d.content) return "";
  return stripTipTap(d.content);
}

function stripTipTap(node: unknown): string {
  if (typeof node === "string") return node;
  if (!node || typeof node !== "object") return "";
  const n = node as { text?: unknown; content?: unknown };
  if (typeof n.text === "string") return n.text;
  if (Array.isArray(n.content)) {
    return n.content.map((c) => stripTipTap(c)).join(" ");
  }
  return "";
}

/**
 * Return a map of `phrase -> mention-count` for candidate topic
 * phrases in the doc text. Mix of:
 *   • Proper-noun-ish n-grams (capitalised runs)
 *   • Frequent content bigrams (both words non-stop, both > 3 chars)
 */
export function extractTopicPhrases(text: string): Array<[string, number]> {
  const counts = new Map<string, number>();

  // Proper-noun runs: `Perovskite Solar Cell`, `DFT`, etc.
  const properRuns = text.match(/\b([A-Z][A-Za-z0-9]*)(?:[\s-]+[A-Z][A-Za-z0-9]*){0,3}\b/g) ?? [];
  for (const raw of properRuns) {
    const phrase = raw.trim();
    if (phrase.length < 4) continue;
    // Skip if it's just a stop-word in title case (e.g. start-of-sentence).
    const first = phrase.split(/\s+/)[0]?.toLowerCase();
    if (first && STOPWORDS.has(first) && !phrase.includes(" ")) continue;
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }

  // Content bigrams (lowercase).
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  for (let i = 0; i + 1 < tokens.length; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (a.length < 4 || b.length < 4) continue;
    if (STOPWORDS.has(a) || STOPWORDS.has(b)) continue;
    const phrase = `${a} ${b}`;
    counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }

  return Array.from(counts.entries()).sort((x, y) => y[1] - x[1]);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let from = 0;
  while (true) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) break;
    count++;
    from = i + needle.length;
  }
  return count;
}

function trim(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Tiny deterministic 32-bit hash (FNV-1a). Used only for de-dup
 * fingerprints, not for security. Same input → same fingerprint
 * lets us recognise an already-surfaced suggestion without storing
 * a separate "seen" set.
 */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
