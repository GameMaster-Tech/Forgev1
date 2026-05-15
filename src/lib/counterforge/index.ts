/**
 * Counterforge — public surface.
 *
 * The skeptic engine. Builds the strongest counter-case it can for
 * every load-bearing claim in your draft, using sources from your
 * own project corpus.
 *
 * See `docs/COUNTERFORGE.md` for the full design.
 */

export type {
  CounterCase,
  CounterCaseStatus,
  CounterEvidence,
  CounterStrength,
  CounterforgeRunSummary,
  CounterforgeSettings,
  ReadinessScore,
} from "./types";

export { DEFAULT_SETTINGS } from "./types";

export {
  createCounterCase,
  listCounterCases,
  findCounterCaseByFingerprint,
  updateCounterCase,
  deleteCounterCase,
  loadSettings,
  saveSettings,
  computeReadiness,
  type CreateCounterCaseInput,
} from "./firestore";

export {
  extractLoadBearingClaims,
  findCounterEvidence,
  synthesiseCounterArgument,
  scoreAsCounter,
  fingerprintClaim,
  type ClaimRow,
  type SnippetRow,
  type DocSection,
  type CounterCandidate,
} from "./detect";

export { scanProject } from "./scan";
