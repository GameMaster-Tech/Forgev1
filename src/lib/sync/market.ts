/**
 * Market-data oracle — mocks live 2026 reality.
 *
 * In production this would back onto a real API (Levels.fyi, BLS,
 * Crunchbase Pro, the Fed, etc.). For now we ship a deterministic table
 * keyed by `AssertionKind` + a tag (role, region, market). Solver calls
 * `lookup()` whenever it needs a real-world anchor to break a paradox.
 *
 * Pure function. Easy to swap for a fetch-based adapter later.
 */

import type { AssertionKind } from "./types";

export interface MarketQuote {
  /** The headline number — solver consumes this. */
  value: number;
  unit: string;
  /** 0..1, how tight the band is. Solver weights changes by this. */
  confidence: number;
  /** P25/P75 bracket so the UI can show "you're inside the band". */
  band: { low: number; high: number };
  /** Synthetic source string the patch will cite. */
  source: string;
  asOf: string; // ISO
}

export interface MarketQuery {
  kind: AssertionKind;
  /** Free-form tag — "senior-engineer", "us-saas", "series-a", etc. */
  tag?: string;
  /** Optional region override. */
  region?: "us" | "eu" | "uk" | "in" | "global";
}

interface QuoteSpec {
  match: (q: MarketQuery) => boolean;
  build: (q: MarketQuery) => MarketQuote;
}

const MAY_2026 = "2026-05-14";

/** Tiny helper so the table stays readable. */
const q = (
  value: number,
  unit: string,
  band: [number, number],
  source: string,
  confidence = 0.86,
): MarketQuote => ({
  value,
  unit,
  band: { low: band[0], high: band[1] },
  confidence,
  source,
  asOf: MAY_2026,
});

/**
 * Hand-curated mock table. Match-first wins. Add entries as the product
 * grows — the contract (MarketQuote) stays stable.
 */
const TABLE: QuoteSpec[] = [
  // ── Salaries ────────────────────────────────────────────────
  {
    match: (m) => m.kind === "salary.annual" && /senior/i.test(m.tag ?? ""),
    build: () =>
      q(
        232_000,
        "USD",
        [205_000, 268_000],
        "Levels.fyi US Senior SWE band, May 2026",
      ),
  },
  {
    match: (m) => m.kind === "salary.annual" && /staff/i.test(m.tag ?? ""),
    build: () =>
      q(
        298_000,
        "USD",
        [265_000, 345_000],
        "Levels.fyi US Staff SWE band, May 2026",
      ),
  },
  {
    match: (m) => m.kind === "salary.annual" && /junior|new.?grad/i.test(m.tag ?? ""),
    build: () =>
      q(
        148_000,
        "USD",
        [125_000, 172_000],
        "Levels.fyi US E3 / new-grad band, May 2026",
      ),
  },
  {
    match: (m) => m.kind === "salary.annual",
    build: () =>
      q(
        198_000,
        "USD",
        [165_000, 235_000],
        "Levels.fyi US SWE all-levels median, May 2026",
        0.7,
      ),
  },

  // ── Rates & runway ──────────────────────────────────────────
  {
    match: (m) => m.kind === "rate.percent" && /fed|interest/i.test(m.tag ?? ""),
    build: () =>
      q(4.25, "percent", [4.0, 4.5], "FOMC effective rate, May 2026", 0.95),
  },
  {
    match: (m) => m.kind === "rate.percent" && /inflation|cpi/i.test(m.tag ?? ""),
    build: () =>
      q(2.6, "percent", [2.3, 2.9], "BLS headline CPI YoY, Apr 2026", 0.9),
  },
  {
    match: (m) => m.kind === "rate.hourly" && /contractor|freelance/i.test(m.tag ?? ""),
    build: () =>
      q(165, "USD/hr", [120, 220], "Upwork/Toptal blended contractor rate, May 2026"),
  },
  {
    match: (m) => m.kind === "runway.months",
    build: () =>
      q(
        18,
        "months",
        [12, 24],
        "Carta Series A runway benchmark, Q1 2026",
        0.78,
      ),
  },

  // ── Budgets ────────────────────────────────────────────────
  {
    match: (m) => m.kind === "budget.lineitem" && /cloud|aws|gcp/i.test(m.tag ?? ""),
    build: () =>
      q(
        12_000,
        "USD/mo",
        [4_000, 35_000],
        "Vantage SaaS cloud spend per-engineer band, 2026",
        0.65,
      ),
  },
  {
    match: (m) => m.kind === "budget.lineitem" && /llm|inference|model/i.test(m.tag ?? ""),
    build: () =>
      q(
        9_400,
        "USD/mo",
        [3_000, 28_000],
        "Anthropic + OpenAI median early-stage spend, Q1 2026",
        0.6,
      ),
  },
  {
    match: (m) => m.kind === "headcount",
    build: () =>
      q(
        12,
        "people",
        [8, 18],
        "Series A team-size benchmark, Carta 2026",
        0.7,
      ),
  },

  // ── Timelines ──────────────────────────────────────────────
  {
    match: (m) => m.kind === "timeline.deadline",
    build: () =>
      q(
        90,
        "days",
        [60, 120],
        "Median MVP → beta cycle, Y Combinator 2026 cohort",
        0.55,
      ),
  },
];

/**
 * Resolve a query against the mock table. Returns `null` if nothing
 * matches — callers must handle that explicitly rather than receiving a
 * silent zero.
 */
export function lookup(query: MarketQuery): MarketQuote | null {
  for (const spec of TABLE) {
    if (spec.match(query)) return spec.build(query);
  }
  return null;
}

/** Build a stable ref string the patch can cite. */
export function marketRef(query: MarketQuery): string {
  const parts: string[] = [query.kind];
  if (query.tag) parts.push(query.tag);
  if (query.region) parts.push(query.region);
  return `market:${parts.join("/")}@${MAY_2026}`;
}
