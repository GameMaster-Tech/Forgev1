/**
 * Truth-decay curve.
 *
 * Trust falls exponentially with age:  trust(t) = floor + (ceiling - floor) * 0.5^(t / halfLife)
 *
 * Half-life is picked per AssertionKind — market salaries decay fast
 * (90d), board mandates slowly (365d), product policy almost never
 * (730d). Pulse rolls these defaults; users can override per-assertion.
 */

import type { Assertion, AssertionKind } from "../sync/types";
import type { DecayProfile, TrustSnapshot } from "./types";

const DEFAULT_PROFILE: DecayProfile = {
  halfLifeDays: 180,
  floor: 0.1,
  ceiling: 1.0,
};

const PROFILES: Partial<Record<AssertionKind, DecayProfile>> = {
  "salary.annual": { halfLifeDays: 90, floor: 0.1, ceiling: 1.0 },
  "rate.percent": { halfLifeDays: 30, floor: 0.05, ceiling: 1.0 },
  "rate.hourly": { halfLifeDays: 60, floor: 0.1, ceiling: 1.0 },
  "budget.lineitem": { halfLifeDays: 60, floor: 0.1, ceiling: 1.0 },
  "budget.total": { halfLifeDays: 180, floor: 0.2, ceiling: 1.0 },
  "headcount": { halfLifeDays: 120, floor: 0.15, ceiling: 1.0 },
  "runway.months": { halfLifeDays: 30, floor: 0.1, ceiling: 1.0 },
  "timeline.deadline": { halfLifeDays: 365, floor: 0.4, ceiling: 1.0 },
  "fact.numeric": { halfLifeDays: 180, floor: 0.1, ceiling: 1.0 },
  "fact.categorical": { halfLifeDays: 365, floor: 0.3, ceiling: 1.0 },
};

const DAY = 86_400_000;

export function profileFor(kind: AssertionKind): DecayProfile {
  return PROFILES[kind] ?? DEFAULT_PROFILE;
}

export function ageDays(a: Assertion, now = Date.now()): number {
  return Math.max(0, (now - a.sourcedAt) / DAY);
}

/** Trust between `floor` and `ceiling`. Pure. */
export function trustAt(a: Assertion, now = Date.now()): number {
  const p = profileFor(a.kind);
  if (p.halfLifeDays <= 0) return clamp01(p.floor * (a.confidence ?? 1));
  if (p.ceiling <= p.floor) return clamp01(p.floor * (a.confidence ?? 1));
  const t = ageDays(a, now);
  const decay = Math.pow(0.5, t / p.halfLifeDays);
  const trust = p.floor + (p.ceiling - p.floor) * decay;
  // Multiplied by the user's write-time confidence so a "hand-wavy"
  // input never reads as fully trusted even on day zero.
  return clamp01(trust * (a.confidence ?? 1));
}

/** When (in ISO) trust will cross `threshold`, given today. */
export function projectInvalidateAt(
  a: Assertion,
  threshold: number,
  now = Date.now(),
): string | undefined {
  const p = profileFor(a.kind);
  if (p.halfLifeDays <= 0 || p.ceiling <= p.floor) return undefined;
  const conf = a.confidence || 1;
  // Solve: floor + (ceiling - floor) * 0.5^(t / halfLife) * confidence = threshold
  const norm = (threshold / conf - p.floor) / (p.ceiling - p.floor);
  if (!Number.isFinite(norm) || norm <= 0) return undefined; // never crosses threshold
  if (norm >= 1) return new Date(now).toISOString();
  const t = (Math.log(norm) / Math.log(0.5)) * p.halfLifeDays;
  const futureMs = a.sourcedAt + t * DAY;
  if (!Number.isFinite(futureMs)) return undefined;
  if (futureMs < now) return new Date(now).toISOString();
  return new Date(futureMs).toISOString();
}

export function snapshot(a: Assertion, invalidateThreshold = 0.45, now = Date.now()): TrustSnapshot {
  const p = profileFor(a.kind);
  return {
    assertionId: a.id,
    ageDays: ageDays(a, now),
    trust: trustAt(a, now),
    halfLifeDays: p.halfLifeDays,
    willInvalidateAt: projectInvalidateAt(a, invalidateThreshold, now),
  };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
