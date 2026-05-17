/**
 * Reality-Sync — the one-call entry point. Wraps decay + diff + refactor
 * into a single `runSync()` that the UI invokes (or a cron firing in
 * production). Pure orchestration — no DOM, no globals.
 */

import type { Assertion, AssertionId } from "../sync/types";
import { log } from "../observability";
import { realityDiff } from "./diff";
import { refactorBlocks } from "./refactor";
import type {
  ContentBlock,
  PulseConfig,
  RealityOracle,
  SyncRun,
} from "./types";

const DEFAULT_CONFIG: Omit<PulseConfig, "projectId"> = {
  cadence: "weekly",
  invalidateThreshold: 0.10,
  staleThreshold: 0.04,
  defaultProfile: { halfLifeDays: 180, floor: 0.1, ceiling: 1.0 },
};

export function defaultConfig(projectId: string): PulseConfig {
  return { projectId, ...DEFAULT_CONFIG };
}

export interface RunSyncInput {
  assertions: Assertion[];
  blocks?: ContentBlock[];
  oracle: RealityOracle;
  config?: Partial<PulseConfig>;
  now?: number;
}

/** Single-call execution: diff → refactor → tally. */
export async function runSync(input: RunSyncInput): Promise<SyncRun> {
  const cfg = { ...defaultConfig("__"), ...(input.config ?? {}) } as PulseConfig;
  const projectId = cfg.projectId === "__" ? input.assertions[0]?.projectId ?? "unknown" : cfg.projectId;
  const ranAtMs = input.now ?? Date.now();
  const startedAt = Date.now();

  const diffs = await realityDiff(input.assertions, input.oracle, cfg, ranAtMs);

  // Build proposals if the caller passed any content blocks.
  const assertionMap = new Map<AssertionId, Assertion>(input.assertions.map((a) => [a.id, a]));
  const refactorProposals = input.blocks ? refactorBlocks(input.blocks, diffs, assertionMap) : [];

  let invalidatedCount = 0;
  let staleCount = 0;
  let freshCount = 0;
  for (const d of diffs) {
    if (d.status === "invalidated") invalidatedCount++;
    else if (d.status === "stale") staleCount++;
    else freshCount++;
  }

  log.event("pulse.sync", {
    projectId,
    blocksScanned: input.blocks?.length ?? 0,
    decayed: invalidatedCount + staleCount,
    refactors: refactorProposals.length,
    durationMs: Date.now() - startedAt,
  });

  return {
    id: `sync_${ranAtMs.toString(36)}`,
    projectId,
    cadence: cfg.cadence,
    ranAt: new Date(ranAtMs).toISOString(),
    diffs,
    invalidatedCount,
    staleCount,
    freshCount,
    refactorProposals,
  };
}

/**
 * Browser-only convenience: schedule a recurring sync via setInterval.
 * Returns a cancel function. Don't use in node — use a real cron.
 */
export function scheduleSync(
  cadence: PulseConfig["cadence"],
  run: () => void | Promise<void>,
): () => void {
  if (typeof window === "undefined") return () => {};
  if (cadence === "manual") return () => {};
  const ms =
    cadence === "daily" ? 24 * 60 * 60 * 1000 :
    cadence === "weekly" ? 7 * 24 * 60 * 60 * 1000 :
    30 * 24 * 60 * 60 * 1000;
  const handle = window.setInterval(() => void run(), ms);
  return () => window.clearInterval(handle);
}
