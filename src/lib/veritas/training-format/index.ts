/**
 * Training-format barrel — pure-TS adapters between Forge schemas and the
 * training pipeline's wire formats. Phase 3 / CP2.
 *
 * No imports of fs / firebase / network — every export here is a pure
 * function safe to call in any execution environment (browser, edge, Node).
 */

export {
  traceToChatML,
  chatMLToTrace,
  TOOL_NAMES,
  type ChatMessage,
  type ChatRole,
  type ChatToolCall,
  type SystemMessage,
  type UserMessage,
  type AssistantMessage,
  type ToolMessage,
  type TraceToChatMLOptions,
} from "./chat-template";

export {
  episodeToSFTExample,
  inferMode,
  estimateTokens,
  validateSFTExample,
  SFT_SCHEMA_VERSION,
  type SFTExample,
  type SFTMode,
  type EpisodeToSFTOptions,
} from "./sft-example";
