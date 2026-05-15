/**
 * Public Pulse API.
 *
 *   import { runSync, trustAt, mockMarketOracle, defaultConfig } from "@/lib/pulse";
 */

export type {
  Cadence,
  ContentBlock,
  DecayProfile,
  PulseConfig,
  RealityDiff,
  RealityOracle,
  RealityReading,
  RefactorProposal,
  SyncRun,
  TrustSnapshot,
} from "./types";

export { trustAt, ageDays, profileFor, snapshot, projectInvalidateAt } from "./decay";
export { realityDiff } from "./diff";
export { refactorBlocks } from "./refactor";
export { mockMarketOracle } from "./reality";
export { runSync, scheduleSync, defaultConfig } from "./schedule";
export { buildDemoBlocks } from "./demo";
