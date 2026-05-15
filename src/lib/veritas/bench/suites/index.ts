/**
 * ForgeBench-Reason — all built-in suites aggregated.
 *
 * Adding a new suite? Import its tasks here and re-export via ALL_TASKS so
 * CI and the dashboard pick it up automatically.
 */

import type { BenchTask } from "../types";
import { CONTRA_DETECT_TASKS } from "./contra-detect";
import { MEMORY_RECALL_TASKS } from "./memory-recall";
import { REASONING_CHAIN_TASKS } from "./reasoning-chain";
import { CONVERSATION_TASKS } from "./conversation";
import { CITATION_TASKS } from "./citation";
import { ABSTENTION_TASKS } from "./abstention";

export {
  CONTRA_DETECT_TASKS,
  MEMORY_RECALL_TASKS,
  REASONING_CHAIN_TASKS,
  CONVERSATION_TASKS,
  CITATION_TASKS,
  ABSTENTION_TASKS,
};

export const ALL_TASKS: BenchTask[] = [
  ...CONTRA_DETECT_TASKS,
  ...MEMORY_RECALL_TASKS,
  ...REASONING_CHAIN_TASKS,
  ...CONVERSATION_TASKS,
  ...CITATION_TASKS,
  ...ABSTENTION_TASKS,
];
