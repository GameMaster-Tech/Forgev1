/**
 * Default reality oracle — wraps the Sync market mock so Pulse can run
 * end-to-end without any external services. Replace with a real fetch
 * adapter in production.
 */

import { lookup, marketRef } from "../sync/market";
import type { Assertion } from "../sync/types";
import type { RealityOracle, RealityReading } from "./types";

/**
 * Builds an oracle that asks the Sync market table for each assertion's
 * kind+tag. Adds a small bounded jitter so successive runs feel "live".
 */
export function mockMarketOracle(seed = 42): RealityOracle {
  const rng = mulberry32(seed);
  return async function realityFor(a: Assertion): Promise<RealityReading | null> {
    const segs = a.key.split(".");
    const tag = segs.length > 1 ? segs.slice(0, -1).join("-") : undefined;
    const q = lookup({ kind: a.kind, tag });
    if (!q) return null;
    // ±3% bounded jitter (deterministic).
    const jitter = 1 + (rng() - 0.5) * 0.06;
    const value = q.value * jitter;
    const reading: RealityReading = {
      value: { type: "number", value: roundForUnit(value, q.unit), unit: q.unit },
      asOf: q.asOf,
      source: `${q.source} [ref: ${marketRef({ kind: a.kind, tag })}]`,
      confidence: q.confidence,
    };
    return reading;
  };
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
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
