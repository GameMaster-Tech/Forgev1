/**
 * ForgeBench-Reason — conversation suite.
 *
 * Measures whether the model sustains grounded research-chat tone:
 *   • concise
 *   • cites the right prior claim
 *   • hedges when the evidence is thin
 *   • no jargon soup
 *
 * These tasks are deliberately shallow — the point is NOT reasoning depth,
 * it's stylistic + grounding consistency over many short turns.
 */

import type { ConversationTask } from "../types";
import { buildClaim } from "../fixtures";

const PROJECT = "proj-bench-conversation";

export const CONVERSATION_TASKS: ConversationTask[] = [
  {
    id: "cv-001",
    suite: "conversation",
    difficulty: "easy",
    title: "Concise, grounded response",
    prompt:
      "Quick answer: does cold exposure increase brown adipose tissue activity in adults?",
    context: {
      claims: [
        buildClaim(PROJECT, {
          id: "cv1-a",
          atomic: "Cold exposure increases brown adipose tissue activity by 2-3 fold in healthy adults",
        }),
      ],
      episodes: [],
      contradictions: [],
    },
    expected: {
      tonePoints: ["concise", "no-jargon"],
      referenceClaimIds: ["cv1-a"],
      maxTokens: 80,
    },
  },
  {
    id: "cv-002",
    suite: "conversation",
    difficulty: "medium",
    title: "Hedge appropriately on weak evidence",
    prompt:
      "What do we know about the effect of rapamycin on human lifespan?",
    authoringNote:
      "Evidence is thin; the answer must hedge — hard-failing this catches over-confident models.",
    context: {
      claims: [
        buildClaim(PROJECT, {
          id: "cv2-a",
          atomic: "Rapamycin extends lifespan in mice across multiple strains",
          sourceSupport: "strong",
        }),
        buildClaim(PROJECT, {
          id: "cv2-b",
          atomic: "Human lifespan data on rapamycin is limited to small off-label cohorts",
          sourceSupport: "weak",
        }),
      ],
      episodes: [],
      contradictions: [],
    },
    expected: {
      tonePoints: ["concise", "hedges-appropriately"],
      referenceClaimIds: ["cv2-a", "cv2-b"],
      maxTokens: 160,
    },
  },
];
