/**
 * Bench model adapters — barrel.
 *
 * Each adapter implements `BenchRunner` (see `../types`). Keep this file
 * an export-only surface; concrete logic lives in sibling files so the
 * runner can be tree-shaken if only one adapter is needed at build time.
 *
 * Adapters available:
 *   • MockBenchRunner       — deterministic CI smoke (oracle / zero / scripted)
 *   • VeritasR1BenchRunner  — live transport to the Forge in-house model
 *
 * No third-party model adapters (Claude Sonnet / GPT / etc) are wired —
 * Veritas-R1 is the only model the user-path runs against once Phase 3/4
 * training lands.
 */

export {
  MockBenchRunner,
  type MockBenchRunnerOptions,
  type MockMode,
} from "./mock-runner";

export {
  VeritasR1BenchRunner,
  type VeritasR1BenchRunnerOptions,
} from "./veritas-r1-runner";
