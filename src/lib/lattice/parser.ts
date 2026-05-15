/**
 * Intent parser.
 *
 * Turns a free-form task string into a structured `ParsedIntent`. Pure
 * — no LLM. The decomposer uses this to pick a template; the watcher
 * uses the resulting signature to dedupe across rebranches.
 *
 * Design choices
 *  • Regex-driven, not statistical. Predictable, fast, debuggable.
 *  • Confidence is calibrated to "how many tokens we recognised";
 *    callers can degrade gracefully when it falls.
 *  • Falls through to `generic` rather than throwing on unrecognised
 *    verbs — Lattice should never deny work because the parser is
 *    surprised.
 */

import type { IntentKind, ParsedIntent } from "./types";

interface VerbSpec {
  kind: IntentKind;
  /** Verbs that map to this intent (lowercase, no punctuation). */
  verbs: string[];
  /** Object-noun hints — if present, confidence is bumped. */
  nouns?: string[];
}

const VERBS: VerbSpec[] = [
  {
    kind: "hire",
    verbs: ["hire", "recruit", "onboard", "fill", "open"],
    nouns: ["engineer", "designer", "analyst", "manager", "headcount", "role", "seat"],
  },
  {
    kind: "launch",
    verbs: ["launch", "ship", "release", "deploy", "rollout", "go-live"],
    nouns: ["beta", "ga", "feature", "product", "campaign"],
  },
  {
    kind: "research",
    verbs: ["research", "investigate", "study", "compare", "benchmark", "survey"],
    nouns: ["competitor", "market", "comp", "trend", "literature"],
  },
  {
    kind: "budget",
    verbs: ["allocate", "budget", "plan", "fund", "forecast"],
    nouns: ["budget", "spend", "runway", "burn", "comp", "payroll"],
  },
  {
    kind: "policy",
    verbs: ["draft", "write", "codify", "ratify", "publish"],
    nouns: ["policy", "guideline", "playbook", "memo", "sop"],
  },
  {
    kind: "report",
    verbs: ["report", "summarise", "summarize", "brief", "update", "present"],
    nouns: ["board", "investor", "stakeholder", "metrics", "kpi"],
  },
  {
    kind: "deadline",
    verbs: ["deliver", "submit", "finalize", "finalise", "freeze"],
    nouns: ["deadline", "milestone", "release"],
  },
];

/* ───────────── helpers ───────────── */

const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "for", "to", "with", "of", "on", "in",
  "at", "by", "from", "into", "onto", "as", "is", "are", "be",
]);

function normalise(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\-\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Extract a leading number from "Hire 4 senior engineers" → 4. */
function extractQuantity(tokens: string[]): { quantity?: number; rest: string[] } {
  const rest = [...tokens];
  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (/^\d+$/.test(t)) {
      const q = parseInt(t, 10);
      if (Number.isFinite(q) && q >= 0 && q < 10_000) {
        rest.splice(i, 1);
        return { quantity: q, rest };
      }
    }
    // Common written numbers.
    const word = WORD_NUMBERS[t];
    if (word !== undefined) {
      rest.splice(i, 1);
      return { quantity: word, rest };
    }
  }
  return { rest };
}

const WORD_NUMBERS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/** Extract "by Sep 15" / "by 2026-09-15" → ISO date. */
function extractByDate(text: string): string | undefined {
  const iso = text.match(/\bby\s+(\d{4}-\d{2}-\d{2})/i);
  if (iso) return iso[1];
  const named = text.match(
    /\bby\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:,?\s*(\d{4}))?/i,
  );
  if (named) {
    const month = MONTHS[named[1].toLowerCase().slice(0, 3)];
    const day = parseInt(named[2], 10);
    const year = named[3] ? parseInt(named[3], 10) : new Date().getFullYear();
    if (month && day >= 1 && day <= 31) {
      const m = String(month).padStart(2, "0");
      const d = String(day).padStart(2, "0");
      return `${year}-${m}-${d}`;
    }
  }
  return undefined;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function pickVerb(tokens: string[]): { spec: VerbSpec | null; verb: string; index: number } {
  // Verbs typically appear in the first 3 tokens. Search all but
  // prefer earliest.
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    for (const spec of VERBS) {
      if (spec.verbs.includes(t)) return { spec, verb: t, index: i };
    }
  }
  return { spec: null, verb: tokens[0] ?? "", index: -1 };
}

function objectFromTokens(tokens: string[], verbIndex: number): string {
  // Everything after the verb, minus stopwords, joined back.
  const tail = tokens.slice(verbIndex + 1).filter((t) => !STOPWORDS.has(t));
  return tail.join(" ").trim();
}

function nounConfidenceBoost(spec: VerbSpec | null, tokens: string[]): number {
  if (!spec || !spec.nouns) return 0;
  return spec.nouns.some((n) => tokens.includes(n)) ? 0.2 : 0;
}

/* ───────────── public API ───────────── */

export function parseIntent(raw: string): ParsedIntent {
  if (!raw || !raw.trim()) {
    return {
      kind: "generic",
      verb: "",
      object: "",
      unresolved: [],
      confidence: 0,
    };
  }
  const text = normalise(raw);
  const byDate = extractByDate(text);
  const tokens = tokenize(text);
  const { quantity, rest: tokensSansQty } = extractQuantity(tokens);
  const { spec, verb, index } = pickVerb(tokensSansQty);
  const kind: IntentKind = spec?.kind ?? "generic";

  // Strip "by …" tail tokens so they don't end up in `object`.
  const dateStripped = byDate
    ? tokensSansQty.slice(0, indexOfByClause(tokensSansQty))
    : tokensSansQty;
  const object = objectFromTokens(
    dateStripped,
    index === -1 ? -1 : index, // keep alignment
  );

  // Confidence calibration:
  //   • verb match: 0.6 baseline
  //   • noun match: +0.2
  //   • quantity or date: +0.1 each (clamped at 1)
  let confidence = spec ? 0.6 : 0.25;
  confidence += nounConfidenceBoost(spec, tokens);
  if (quantity != null) confidence += 0.1;
  if (byDate) confidence += 0.1;
  confidence = Math.min(1, Math.max(0, confidence));

  const unresolved: string[] = [];
  if (!spec) unresolved.push(`no verb recognised — defaulted to generic`);
  if (!object) unresolved.push("no object after the verb");

  return {
    kind,
    verb: spec ? verb : tokens[0] ?? "",
    object,
    quantity,
    byDate,
    unresolved,
    confidence,
  };
}

function indexOfByClause(tokens: string[]): number {
  const i = tokens.indexOf("by");
  return i === -1 ? tokens.length : i;
}

/**
 * Stable signature for an intent — same parent string and same context-
 * relevant tokens → same signature, so subtask dedup works across
 * rebranches even when the user edits the prompt slightly.
 */
export function intentSignature(p: ParsedIntent): string {
  const parts = [
    p.kind,
    p.verb || "_",
    p.object.replace(/\s+/g, "_") || "_",
    p.quantity != null ? `q${p.quantity}` : "",
    p.byDate ? `d${p.byDate}` : "",
  ];
  return parts.filter(Boolean).join(":");
}
