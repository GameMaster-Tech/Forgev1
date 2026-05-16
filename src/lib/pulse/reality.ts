/**
 * Reality oracles — the data sources Pulse compares the workspace
 * against.
 *
 * The original implementation was a single market mock; this module now
 * exposes a registry that supports composing multiple oracles. Each
 * registered oracle declares:
 *   • an `id` and a `name`
 *   • a `match` predicate over (kind, tag)
 *   • a `priority` weight (higher dominates blends)
 *   • an async `fetch` returning a RealityReading
 *
 * `OracleRegistry.query(assertion)` returns every matching contribution.
 * `OracleRegistry.asOracle()` returns a callable that blends them via
 * priority-weighted average — numeric values average, categorical
 * values fall back to the highest-priority opinion.
 *
 * The Sync market mock is registered automatically; a second "policy"
 * oracle ships with the registry to demo categorical composition.
 */

import { lookup, marketRef } from "../sync/market";
import type { Assertion } from "../sync/types";
import type {
  OracleContribution,
  OracleRegistry,
  RealityOracle,
  RealityReading,
  RegisteredOracle,
} from "./types";

/* ───────────── primitives ───────────── */

function tagFor(a: Assertion): string | undefined {
  const segs = a.key.split(".");
  return segs.length > 1 ? segs.slice(0, -1).join("-") : undefined;
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundForUnit(v: number, unit?: string): number {
  if (!unit) return Math.round(v);
  if (/USD|EUR|GBP/.test(unit)) return Math.round(v / 100) * 100;
  if (/percent/i.test(unit)) return Math.round(v * 100) / 100;
  if (/month|day|people/i.test(unit)) return Math.round(v);
  return Math.round(v);
}

/* ───────────── built-in: market oracle ───────────── */

/**
 * Builds the legacy market oracle as a `RegisteredOracle`. Pulled from
 * the Sync market mock; matches any kind/tag the market table knows.
 */
export function buildMarketOracle(seed = 42, priority = 1): RegisteredOracle {
  const rng = mulberry32(seed);
  return {
    id: "market",
    name: "Sync market mock",
    priority,
    match: ({ kind, tag }) => lookup({ kind, tag }) != null,
    async fetch(a: Assertion): Promise<RealityReading | null> {
      const tag = tagFor(a);
      const quote = lookup({ kind: a.kind, tag });
      if (!quote) return null;
      const jitter = 1 + (rng() - 0.5) * 0.06;
      return {
        value: { type: "number", value: roundForUnit(quote.value * jitter, quote.unit), unit: quote.unit },
        asOf: quote.asOf,
        source: `${quote.source} [ref: ${marketRef({ kind: a.kind, tag })}]`,
        confidence: quote.confidence,
      };
    },
  };
}

/**
 * Legacy single-oracle API. Kept for backwards-compat: callers that
 * only want the market mock can still call `mockMarketOracle()`.
 */
export function mockMarketOracle(seed = 42): RealityOracle {
  const reg = buildMarketOracle(seed).fetch;
  return (a: Assertion) => reg(a);
}

/* ───────────── built-in: policy oracle ───────────── */

/**
 * The policy oracle services `fact.categorical` assertions tagged with
 * policy-like keys (e.g. `compliance.cookieBanner = "enabled"`). It
 * answers from an in-memory policy registry; in production this would
 * back onto a compliance database or a feature-flag service.
 *
 * The default registry below ships a few entries so the demo can
 * showcase categorical composition (market + policy contributing to
 * the same diff).
 */
interface PolicyEntry {
  value: Assertion["value"];
  source: string;
  asOf: string;
  confidence: number;
}

const POLICY_REGISTRY: Record<string, PolicyEntry> = {
  "compliance.cookieBanner": {
    value: { type: "string", value: "enabled" },
    source: "Compliance policy table (May 2026)",
    asOf: "2026-05-14",
    confidence: 0.97,
  },
  "policy.remoteWork": {
    value: { type: "string", value: "hybrid" },
    source: "People-Ops handbook §4.2",
    asOf: "2026-04-01",
    confidence: 0.92,
  },
  // Mirrors the workspace's `runway.months` so the policy oracle blends
  // with the market oracle for an end-to-end multi-oracle demo.
  "runway.months": {
    value: { type: "number", value: 16, unit: "months" },
    source: "Board mandate, April 2026",
    asOf: "2026-04-30",
    confidence: 0.95,
  },
  "milestone.target": {
    value: { type: "date", value: "2026-12-15" },
    source: "Roadmap committee, May 2026",
    asOf: "2026-05-10",
    confidence: 0.85,
  },
};

export function buildPolicyOracle(priority = 2, overrides: Record<string, PolicyEntry> = {}): RegisteredOracle {
  const registry = { ...POLICY_REGISTRY, ...overrides };
  return {
    id: "policy",
    name: "Internal policy registry",
    priority,
    // Match by either the assertion key OR — for categorical kinds —
    // any policy entry the assertion's KIND can subscribe to. Pulse's
    // primary use case for `fact.categorical` is policy-tracked.
    match: ({ assertion }) => {
      if (registry[assertion.key] != null) return true;
      if (assertion.kind === "fact.categorical" && assertion.value.type === "string") {
        return registry[assertion.key] != null;
      }
      return false;
    },
    async fetch(a: Assertion): Promise<RealityReading | null> {
      const entry = registry[a.key];
      if (!entry) return null;
      return {
        value: entry.value,
        source: entry.source,
        asOf: entry.asOf,
        confidence: entry.confidence,
      };
    },
  };
}

/* ───────────── registry ───────────── */

export function createOracleRegistry(initial: RegisteredOracle[] = []): OracleRegistry {
  const oracles = new Map<string, RegisteredOracle>();
  for (const o of initial) oracles.set(o.id, o);

  function matching(a: Assertion): RegisteredOracle[] {
    const tag = tagFor(a);
    const out: RegisteredOracle[] = [];
    for (const o of oracles.values()) {
      try {
        if (o.match({ kind: a.kind, tag, assertion: a })) out.push(o);
      } catch {
        // Match functions must be pure + cheap; swallow errors to keep
        // the registry resilient.
      }
    }
    // Sort by priority desc for deterministic UI ordering.
    out.sort((x, y) => y.priority - x.priority);
    return out;
  }

  async function query(a: Assertion): Promise<OracleContribution[]> {
    const candidates = matching(a);
    const settled = await Promise.allSettled(candidates.map((o) => o.fetch(a)));
    const out: OracleContribution[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const o = candidates[i];
      const r = settled[i];
      if (r.status !== "fulfilled" || !r.value) continue;
      out.push({
        oracleId: o.id,
        oracleName: o.name,
        priority: Math.max(0, o.priority),
        reading: r.value,
      });
    }
    return out;
  }

  function asOracle(): RealityOracle {
    return async (a: Assertion): Promise<RealityReading | null> => {
      const contribs = await query(a);
      return blendContributions(contribs);
    };
  }

  return {
    register: (o) => { oracles.set(o.id, o); },
    unregister: (id) => { oracles.delete(id); },
    list: () => Array.from(oracles.values()),
    matching,
    query,
    asOracle,
  };
}

/**
 * Blend multiple contributions into a single reading.
 *
 * Strategy:
 *   • Empty input → null.
 *   • Single contribution → return it verbatim.
 *   • Numeric values → priority-weighted average. The blended source
 *     lists every contributor; confidence is the priority-weighted
 *     mean.
 *   • Categorical values → highest-priority contribution wins. Ties
 *     broken by oracle id (deterministic).
 */
export function blendContributions(contribs: OracleContribution[]): RealityReading | null {
  if (contribs.length === 0) return null;
  if (contribs.length === 1) return contribs[0].reading;

  const totalWeight = contribs.reduce((acc, c) => acc + Math.max(0, c.priority), 0);
  if (totalWeight <= 0) return contribs[0].reading;

  const allNumeric = contribs.every((c) => c.reading.value.type === "number");
  if (allNumeric) {
    let weighted = 0;
    let weightedConf = 0;
    let unit: string | undefined;
    for (const c of contribs) {
      const v = c.reading.value;
      if (v.type !== "number") continue;
      const w = Math.max(0, c.priority);
      weighted += v.value * w;
      weightedConf += c.reading.confidence * w;
      unit ??= v.unit;
    }
    const blendedValue = weighted / totalWeight;
    const blendedConf = weightedConf / totalWeight;
    const sources = contribs
      .map((c) => `${c.oracleName} (×${c.priority})`)
      .join(" + ");
    return {
      value: { type: "number", value: roundForUnit(blendedValue, unit), unit },
      source: sources,
      asOf: latestAsOf(contribs),
      confidence: clamp01(blendedConf),
    };
  }

  // Categorical fallback — highest-priority wins.
  const sorted = [...contribs].sort((a, b) =>
    b.priority - a.priority || a.oracleId.localeCompare(b.oracleId),
  );
  return sorted[0].reading;
}

function latestAsOf(contribs: OracleContribution[]): string {
  let max = "";
  for (const c of contribs) {
    if (c.reading.asOf > max) max = c.reading.asOf;
  }
  return max || new Date().toISOString();
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * Build a registry pre-loaded with the market + policy oracles. The
 * Pulse page calls this for its demo. Production callers can construct
 * an empty registry and register oracles individually.
 */
export function defaultRegistry(seed = 42): OracleRegistry {
  return createOracleRegistry([buildMarketOracle(seed, 1), buildPolicyOracle(2)]);
}
