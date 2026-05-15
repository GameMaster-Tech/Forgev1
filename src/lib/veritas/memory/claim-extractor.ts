/**
 * Atomic Claim Extractor — heuristic baseline (schema v2.1).
 *
 * In production, this is replaced by a Veritas-R1 pass that emits structured
 * claims directly. For Phase 0 we ship a sentence-splitter + normaliser that
 * produces NewClaimInput objects ready to feed into the ClaimGraph.
 *
 * Rules applied (in order):
 *   1. Split text into sentences, respecting common abbreviations.
 *   2. Drop sentences shorter than MIN_LEN or longer than MAX_LEN.
 *   3. Drop interrogative / imperative sentences.
 *   4. Normalise: strip citation markers, trim trailing qualifiers.
 *   5. Assign polarity / assertiveness / extractor certainty heuristically.
 *   6. Parse a QuantitativeFact when percentages / point estimates appear.
 *   7. Pull a free-form scope from leading qualifier clauses.
 *   8. Stamp every claim with `extractedBy` + `derivation` so the training
 *      pipeline can locate and supersede heuristic-baseline rows cleanly
 *      after the Veritas-R1 extractor comes online.
 *
 * This is deliberately conservative — the downstream training pipeline
 * prefers missing a claim over emitting a wrong one.
 */

import type {
  Assertiveness,
  ClaimDerivation,
  ClaimScope,
  Direction,
  DocLocation,
  ExtractorCertainty,
  ExtractorSignature,
  Polarity,
  QuantitativeFact,
  SourceAttribution,
  SourceSupport,
} from "./schema";
import type { NewClaimInput } from "./claim-graph";
import { isoNow } from "./ids";

/** Semver-style version for the heuristic extractor output shape. Bump on
 *  any change to the rules below so bulk-reprocessing can target old rows. */
export const HEURISTIC_EXTRACTOR_VERSION = "0.2.0";
export const HEURISTIC_EXTRACTOR_NAME = "heuristic-baseline";

const MIN_LEN = 30;
const MAX_LEN = 360;

const HEDGING = [
  "may", "might", "could", "suggests", "suggest", "appears", "appear",
  "seems", "possibly", "potentially", "likely",
];
const STRONG = [
  "demonstrate", "demonstrated", "show", "showed", "prove", "proved",
  "confirmed", "established", "found", "reported",
];
const NEGATION = [
  " not ", " no ", "n't", " never ", " without ", " fail to ", " failed to ",
];

/* ─────────────────────────────────────────────────────────────
 *  Input
 * ──────────────────────────────────────────────────────────── */

export interface ExtractorInput {
  projectId: string;
  userId: string;
  text: string;
  docId?: string;
  /** Character offset where `text` starts inside the authoring document. */
  docTextOffset?: number;
  /** Sources to attach as attributions. Default role is "primary-support". */
  attributions?: SourceAttribution[];
  /** Optional pre-resolved topic id. */
  topicId?: string;
  /** Optional pre-resolved entity ids. */
  entities?: string[];
}

/* ─────────────────────────────────────────────────────────────
 *  Entry point
 * ──────────────────────────────────────────────────────────── */

export function extractClaims(input: ExtractorInput): NewClaimInput[] {
  const sentences = splitSentencesWithOffsets(input.text);
  const out: NewClaimInput[] = [];

  // Single timestamp for the whole batch — lets downstream tools detect
  // "these claims were produced together" for cheaper replay.
  const at = isoNow();
  const extractedBy: ExtractorSignature = {
    extractor: HEURISTIC_EXTRACTOR_NAME,
    version: HEURISTIC_EXTRACTOR_VERSION,
    at,
  };

  for (const { sentence, start, end } of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length < MIN_LEN || trimmed.length > MAX_LEN) continue;
    if (isNonAssertive(trimmed)) continue;

    const atomic = normalise(trimmed);
    if (atomic.length < MIN_LEN) continue;

    const polarity = polarityOf(trimmed);
    const assertiveness = assertivenessOf(trimmed);
    const extractorCertainty = extractorCertaintyOf(trimmed, atomic);
    const quantitative = parseQuantitative(trimmed);
    const scope = parseScope(trimmed);

    const attributions = input.attributions ?? [];
    const sourceSupport = deriveSourceSupport(attributions);

    const docLocation: DocLocation | undefined = input.docId
      ? {
          docId: input.docId,
          startOffset: (input.docTextOffset ?? 0) + start,
          endOffset: (input.docTextOffset ?? 0) + end,
        }
      : undefined;

    const derivation: ClaimDerivation = {
      kind: "extracted",
      parentClaimIds: [],
    };

    out.push({
      projectId: input.projectId,
      userId: input.userId,
      text: trimmed,
      atomicAssertion: atomic,
      polarity,
      assertiveness,
      extractorCertainty,
      sourceSupport,
      quantitative,
      scope,
      attributions,
      entities: input.entities ?? [],
      topicId: input.topicId,
      docLocation,
      derivation,
      extractedBy,
      // Heuristic-baseline claims should be surfaced for a human or Veritas-R1
      // review when certainty is low — the flag is cheap to read in the UI.
      needsReview: extractorCertainty === "low",
    });
  }

  return dedupByAssertion(out);
}

/* ─────────────────────────────────────────────────────────────
 *  Sentence splitting (with offsets, so we can populate DocLocation)
 * ──────────────────────────────────────────────────────────── */

const ABBREV = /\b(?:e\.g|i\.e|cf|al|etc|fig|vs|mr|mrs|dr|prof|ca|approx)\./gi;
const ABBREV_PLACEHOLDER = "<<ABR>>";

interface OffsetSentence {
  sentence: string;
  start: number;
  end: number;
}

function splitSentencesWithOffsets(text: string): OffsetSentence[] {
  if (!text) return [];

  // Preserve char counts by replacing abbrev period with placeholder of equal length.
  // Since the placeholder differs in length, we instead run the splitter on masked
  // text and recover offsets by re-finding each sentence's position in the original.
  const masked = text.replace(ABBREV, (m) => m.replace(".", ABBREV_PLACEHOLDER));
  const rough = masked
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=[A-Z(])/);

  const out: OffsetSentence[] = [];
  let cursor = 0;
  for (const frag of rough) {
    const restored = frag.replace(new RegExp(ABBREV_PLACEHOLDER, "g"), ".");
    const idx = text.indexOf(restored, cursor);
    if (idx === -1) {
      // Whitespace collapsing broke indexOf; fall back to sequential cursor.
      out.push({ sentence: restored, start: cursor, end: cursor + restored.length });
      cursor += restored.length;
    } else {
      out.push({ sentence: restored, start: idx, end: idx + restored.length });
      cursor = idx + restored.length;
    }
  }
  return out;
}

function isNonAssertive(s: string): boolean {
  if (s.endsWith("?")) return true;
  if (/^(how|what|why|when|where|who|does|do|is|are|can|should|would|could)\b/i.test(s)) {
    return true;
  }
  if (/^(please|note|see|refer|consider)\b/i.test(s)) return true;
  return false;
}

/* ─────────────────────────────────────────────────────────────
 *  Normalisation
 * ──────────────────────────────────────────────────────────── */

const CITATION_PAREN = /\(\s*(?:[A-Z][A-Za-z'’-]+(?:\s+(?:et al\.?|and)\s+[A-Z][A-Za-z'’-]+)?)?,?\s*\d{4}[a-z]?\s*(?:;\s*[^()]+)?\)/g;
const CITATION_BRACKET = /\[\s*\d+(?:\s*[-,]\s*\d+)*\s*\]/g;
const TRAILING_QUALIFIERS = /\s*(?:;|,)?\s*(?:however|although|nevertheless|in addition|moreover|furthermore)\s*[,.].*$/i;

function normalise(s: string): string {
  return s
    .replace(CITATION_PAREN, "")
    .replace(CITATION_BRACKET, "")
    .replace(TRAILING_QUALIFIERS, "")
    .replace(/\s+/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

/* ─────────────────────────────────────────────────────────────
 *  Dimension inference
 * ──────────────────────────────────────────────────────────── */

function polarityOf(s: string): Polarity {
  const lower = ` ${s.toLowerCase()} `;
  if (NEGATION.some((n) => lower.includes(n))) return "negates";
  if (!STRONG.some((v) => lower.includes(v)) && !HEDGING.some((h) => lower.includes(h))) {
    return "descriptive";
  }
  return "asserts";
}

function assertivenessOf(s: string): Assertiveness {
  const lower = s.toLowerCase();
  const hedges = HEDGING.filter((h) => lower.includes(h)).length;
  const strong = STRONG.filter((v) => lower.includes(v)).length;
  if (hedges >= 2) return "hedged";
  if (hedges === 1 && strong === 0) return "qualified";
  return "direct";
}

function extractorCertaintyOf(originalSentence: string, atomic: string): ExtractorCertainty {
  // If normalisation stripped a substantial portion (lots of qualifying noise),
  // we're less confident the atomic faithfully captures the claim.
  const ratio = atomic.length / Math.max(1, originalSentence.length);
  if (ratio < 0.5) return "low";
  if (ratio < 0.8) return "medium";
  return "high";
}

/* ─────────────────────────────────────────────────────────────
 *  Quantitative payload parser
 * ──────────────────────────────────────────────────────────── */

function parseQuantitative(s: string): QuantitativeFact | undefined {
  const lower = s.toLowerCase();

  // Percentage change
  const pctMatch = lower.match(/(?:by|of)\s+(\d+(?:\.\d+)?)\s*(%|percent)/);
  const directionHint = detectDirection(lower);
  if (pctMatch) {
    return {
      metric: "percent-change",
      value: parseFloat(pctMatch[1]),
      unit: "%",
      direction: directionHint,
    };
  }

  // Hazard / odds / risk ratio. The bare abbreviations `hr`/`or`/`rr` require
  // a numeric colon/equals separator — otherwise we match the English word
  // "or" or the honorific "hr" and emit garbage quantitative facts.
  const hrMatchFull = lower.match(/\b(hazard ratio|odds ratio|risk ratio)\s*[:=]?\s*(\d+(?:\.\d+)?)/);
  if (hrMatchFull) {
    return {
      metric: hrMatchFull[1].replace(/\s+/g, "-"),
      value: parseFloat(hrMatchFull[2]),
      direction: directionHint,
    };
  }
  const hrMatchAbbr = lower.match(/\b(hr|or|rr)\s*[:=]\s*(\d+(?:\.\d+)?)/);
  if (hrMatchAbbr) {
    const abbrToMetric: Record<string, string> = {
      hr: "hazard-ratio",
      or: "odds-ratio",
      rr: "risk-ratio",
    };
    return {
      metric: abbrToMetric[hrMatchAbbr[1]] ?? hrMatchAbbr[1],
      value: parseFloat(hrMatchAbbr[2]),
      direction: directionHint,
    };
  }

  // P-value
  const pMatch = lower.match(/p\s*[<=]\s*(0?\.\d+)/);
  if (pMatch && directionHint !== "unknown") {
    return {
      metric: "p-value",
      value: parseFloat(pMatch[1]),
      direction: directionHint,
    };
  }

  return undefined;
}

function detectDirection(lower: string): Direction {
  const up = ["increase", "increased", "raise", "raised", "elevate", "elevated", "higher", "greater"];
  const down = ["decrease", "decreased", "reduce", "reduced", "lower", "lowered", "diminish", "diminished"];
  const nochange = ["no change", "no difference", "unchanged", "no effect"];
  for (const w of nochange) if (lower.includes(w)) return "no-change";
  for (const w of up) if (lower.includes(w)) return "increase";
  for (const w of down) if (lower.includes(w)) return "decrease";
  return "unknown";
}

/* ─────────────────────────────────────────────────────────────
 *  Scope extraction (lightweight)
 * ──────────────────────────────────────────────────────────── */

const POPULATION_CUES = [
  /\bin\s+(adults?|children|infants?|elderly|patients?\s+with[^,.]+|mice|rats|women|men)\b/i,
  /\bamong\s+([a-z ]{3,40})\b/i,
];
const SETTING_CUES: Array<{ re: RegExp; val: string }> = [
  { re: /\bin\s+vitro\b/i,       val: "in-vitro" },
  { re: /\bin\s+vivo\b/i,        val: "in-vivo" },
  { re: /\bclinical\s+trial\b/i, val: "clinical-trial" },
  { re: /\bobservational\b/i,    val: "observational" },
  { re: /\bmeta[-\s]analysis\b/i, val: "meta-analysis" },
  { re: /\bcohort\s+study\b/i,   val: "cohort" },
];
const DOSE_CUE = /(\b\d+(?:\.\d+)?\s*(?:mg|µg|ug|g|ml|mL|IU|mmol|µmol)(?:\/(?:kg|day|dl|dL|L))?)\b/;

function parseScope(s: string): ClaimScope {
  const scope: ClaimScope = {};

  for (const re of POPULATION_CUES) {
    const m = s.match(re);
    if (m) {
      scope.population = m[1].trim();
      break;
    }
  }
  for (const { re, val } of SETTING_CUES) {
    if (re.test(s)) {
      scope.setting = val;
      break;
    }
  }
  const dm = s.match(DOSE_CUE);
  if (dm) scope.dose = dm[1];

  return scope;
}

/* ─────────────────────────────────────────────────────────────
 *  Source support derivation
 * ──────────────────────────────────────────────────────────── */

function deriveSourceSupport(attributions: SourceAttribution[]): SourceSupport {
  if (attributions.length === 0) return "unsourced";
  const supporting = attributions.filter(
    (a) => a.role === "primary-support" || a.role === "secondary-support",
  );
  if (supporting.length === 0) return "unsourced";
  if (supporting.length >= 3) return "strong";
  if (supporting.length === 2) return "moderate";
  return "weak";
}

/* ─────────────────────────────────────────────────────────────
 *  Deduplication (within a single extraction batch)
 * ──────────────────────────────────────────────────────────── */

function dedupByAssertion(claims: NewClaimInput[]): NewClaimInput[] {
  const seen = new Set<string>();
  const out: NewClaimInput[] = [];
  for (const c of claims) {
    const key = c.atomicAssertion.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
