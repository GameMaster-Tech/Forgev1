/**
 * Reality-Diff — compares workspace truth against the oracle, applies
 * thresholds, and produces a status verdict for each assertion.
 *
 * Pure given a fixed oracle output. The oracle itself is the only async
 * boundary; the diff math is sync.
 */

import type { Assertion } from "../sync/types";
import { trustAt } from "./decay";
import type {
  PulseConfig,
  RealityDiff,
  RealityOracle,
  RealityReading,
} from "./types";

export async function realityDiff(
  assertions: Assertion[],
  oracle: RealityOracle,
  cfg: Pick<PulseConfig, "invalidateThreshold" | "staleThreshold">,
  now = Date.now(),
): Promise<RealityDiff[]> {
  const out: RealityDiff[] = [];
  // Sequential. The oracle is cheap in mock form; switching to
  // Promise.all is a one-line change if we move to a real network
  // adapter that supports concurrency.
  for (const a of assertions) {
    if (a.locked) {
      out.push(passthrough(a, null, now, "Locked by user — skipped reality check.", "fresh"));
      continue;
    }
    let reading: RealityReading | null = null;
    try {
      reading = await oracle(a);
    } catch {
      reading = null;
    }
    if (!reading) {
      out.push(passthrough(a, null, now, "No oracle reading available for this kind.", "fresh"));
      continue;
    }
    out.push(compare(a, reading, cfg, now));
  }
  return out;
}

function compare(
  a: Assertion,
  r: RealityReading,
  cfg: Pick<PulseConfig, "invalidateThreshold" | "staleThreshold">,
  now: number,
): RealityDiff {
  const trustBefore = trustAt(a, now);
  let delta = 0;
  let driftRatio = 0;
  if (a.value.type === "number" && r.value.type === "number") {
    delta = Math.abs(a.value.value - r.value.value);
    const denom = Math.max(1, Math.abs(a.value.value));
    driftRatio = delta / denom;
  } else if (a.value.type === "string" && r.value.type === "string") {
    const same = a.value.value.trim() === r.value.value.trim();
    delta = same ? 0 : 1;
    driftRatio = same ? 0 : 1;
  } else if (a.value.type === "date" && r.value.type === "date") {
    const diff = Math.abs(new Date(a.value.value).getTime() - new Date(r.value.value).getTime());
    delta = diff;
    // Use 30d as the denominator so dates drift on a meaningful scale.
    driftRatio = diff / (30 * 86_400_000);
  } else if (a.value.type === "boolean" && r.value.type === "boolean") {
    delta = a.value.value === r.value.value ? 0 : 1;
    driftRatio = delta;
  }

  let status: RealityDiff["status"] = "fresh";
  if (driftRatio >= cfg.invalidateThreshold) status = "invalidated";
  else if (driftRatio >= cfg.staleThreshold) status = "stale";

  const trustAfter = status === "invalidated" ? 0 : trustBefore;

  const message =
    status === "invalidated"
      ? `Workspace value drifted ${(driftRatio * 100).toFixed(1)}% from current reality (${describe(r.value)}, ${r.source}).`
      : status === "stale"
      ? `Workspace value drifted ${(driftRatio * 100).toFixed(1)}% — within the stale band, refresh suggested.`
      : `Within tolerance. Reality reads ${describe(r.value)}.`;

  return {
    assertionId: a.id,
    workspaceValue: a.value,
    realityValue: r.value,
    delta,
    driftRatio,
    status,
    trustBefore,
    trustAfter,
    realitySource: r.source,
    realityAsOf: r.asOf,
    message,
  };
}

function passthrough(
  a: Assertion,
  r: RealityReading | null,
  now: number,
  message: string,
  status: RealityDiff["status"],
): RealityDiff {
  const trust = trustAt(a, now);
  return {
    assertionId: a.id,
    workspaceValue: a.value,
    realityValue: r?.value ?? null,
    delta: 0,
    driftRatio: 0,
    status,
    trustBefore: trust,
    trustAfter: trust,
    realitySource: r?.source,
    realityAsOf: r?.asOf,
    message,
  };
}

function describe(v: Assertion["value"]): string {
  switch (v.type) {
    case "number": return `${v.value.toLocaleString()}${v.unit ? " " + v.unit : ""}`;
    case "string": return `"${v.value}"`;
    case "date": return v.value;
    case "boolean": return v.value ? "true" : "false";
  }
}
