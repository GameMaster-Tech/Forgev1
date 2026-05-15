/**
 * Research Planner — public surface.
 *
 * Consumed by the planner UI (`src/components/research-planner/`) and
 * any background scanner that decides to run detection on a schedule.
 *
 * Design rule from the user: Forge surfaces gaps but NEVER creates a
 * PlanItem without explicit user acceptance. `acceptSuggestion()` is
 * the only path from a Suggestion to a PlanItem.
 */

export type {
  Suggestion,
  SuggestionKind,
  SuggestionStatus,
  PlanItem,
  PlanItemStatus,
  PlannerWeights,
  ScanResult,
} from "./types";

export {
  ALL_KINDS,
  DEFAULT_KIND_WEIGHT,
  WEIGHT_FLOOR,
  WEIGHT_CEILING,
  ACCEPT_BUMP,
  DISMISS_DROP,
} from "./types";

export {
  createSuggestion,
  listSuggestions,
  getSuggestionByFingerprint,
  markSuggestionStatus,
  deleteSuggestion,
  acceptSuggestion,
  dismissSuggestion,
  createPlanItem,
  listPlanItems,
  updatePlanItem,
  deletePlanItem,
  loadWeights,
  saveWeights,
  type CreateSuggestionInput,
  type CreatePlanItemInput,
} from "./firestore";

export {
  detectUndersupportedClaims,
  detectUnderreadTopics,
  detectContradictions,
  extractTopicPhrases,
  type SuggestionCandidate,
  type ClaimRow,
  type ContradictionRow,
  type DocumentRow,
  type SnippetRow,
} from "./detectors";

export { scanProject, applyLearningDelta, recordDecision } from "./scan";
