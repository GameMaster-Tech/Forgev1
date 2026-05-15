/**
 * Forge Recall — public surface.
 *
 * Three primitives (Snippet, Correction, Pin), one retrieval function,
 * one refusal helper. That's the whole API.
 *
 *   import { recall, refusalFor, createSnippet, pinSnippet,
 *            extractSnippetsFromUserTurn, detectCorrectionTrigger,
 *            linkCorrection } from "@/lib/recall";
 *
 * Wiring into the chat path lives in `src/app/api/chat/route.ts` —
 * each user turn extracts snippets, detects corrections, then calls
 * `recall()` to build the assistant's context. The assistant turn does
 * the same extraction so the AI's own assertions enter the corpus.
 *
 * Rationale + Claude/GPT/Gemini comparison live in `docs/RECALL.md`.
 */

export type {
  Snippet,
  SnippetOrigin,
  Correction,
  RecallRequest,
  RecallResult,
  ScoredSnippet,
} from "./types";

export {
  createSnippet,
  getProjectSnippets,
  getSnippet,
  pinSnippet,
  unpinSnippet,
  deleteSnippet,
  recordUse,
  linkCorrection,
  detectCorrectionTrigger,
  getCorrectionsForProject,
  extractSnippetsFromUserTurn,
  extractSnippetsFromAssistantTurn,
  extractSnippetsFromDoc,
  type CreateSnippetInput,
} from "./snippet";

export { recall } from "./retrieve";

export { refusalFor, type RefusalDirective } from "./refuse";
