/**
 * Public Pulse API.
 *
 *   import { runSync, trustAt, mockMarketOracle, defaultConfig } from "@/lib/pulse";
 */

export type {
  Cadence,
  ContentBlock,
  DecayProfile,
  OracleContribution,
  OracleRegistry,
  PulseConfig,
  RealityDiff,
  RealityOracle,
  RealityReading,
  RefactorProposal,
  RegisteredOracle,
  SyncRun,
  TrustSnapshot,
} from "./types";

export { trustAt, ageDays, profileFor, snapshot, projectInvalidateAt } from "./decay";
export { realityDiff } from "./diff";
export { refactorBlocks } from "./refactor";
export {
  blendContributions,
  buildMarketOracle,
  buildPolicyOracle,
  createOracleRegistry,
  defaultRegistry,
  mockMarketOracle,
} from "./reality";
export { runSync, scheduleSync, defaultConfig } from "./schedule";
export { buildDemoBlocks } from "./demo";

export {
  REJECTION_TTL_DAYS,
  REJECTION_TTL_MS,
  filterRejected,
  pruneRejections,
  rejectionKey,
  rejectionKeyOf,
} from "./rejection";
