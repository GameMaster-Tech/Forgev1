/**
 * ForgeBench-Reason — reasoning-chain suite.
 *
 * Measures whether the model can chain multiple claims into a non-trivial
 * conclusion — the "understands the logic" capability from the Forge moat.
 */

import type { ReasoningChainTask } from "../types";
import { buildClaim } from "../fixtures";

const PROJECT = "proj-bench-reasoning";

export const REASONING_CHAIN_TASKS: ReasoningChainTask[] = [
  {
    id: "rc-001",
    suite: "reasoning-chain",
    difficulty: "medium",
    title: "Transitive mechanism",
    prompt:
      "Given what we already know, what effect should drug A have on inflammatory bowel disease severity? Show your chain.",
    context: {
      claims: [
        buildClaim(PROJECT, {
          id: "rc1-a",
          atomic: "Drug A selectively inhibits JAK1",
        }),
        buildClaim(PROJECT, {
          id: "rc1-b",
          atomic: "JAK1 inhibition reduces IL-6 signalling",
        }),
        buildClaim(PROJECT, {
          id: "rc1-c",
          atomic: "IL-6 signalling drives mucosal inflammation in IBD",
        }),
        buildClaim(PROJECT, {
          id: "rc1-d",
          atomic: "Reduced mucosal inflammation correlates with lower IBD severity scores",
        }),
        buildClaim(PROJECT, {
          id: "rc1-x",
          atomic: "Drug A has no renal clearance issues in healthy volunteers",
        }),
      ],
      episodes: [],
      contradictions: [],
    },
    expected: {
      supportingClaimIds: ["rc1-a", "rc1-b", "rc1-c", "rc1-d"],
      finalAnswer: "Drug A is expected to reduce IBD severity by lowering IL-6 driven mucosal inflammation via JAK1 inhibition",
      minChainLength: 4,
    },
  },
  {
    id: "rc-002",
    suite: "reasoning-chain",
    difficulty: "hard",
    title: "Contradiction-aware synthesis",
    prompt:
      "Summarise the effect of high-intensity interval training on insulin sensitivity in older adults, noting any conflicting evidence.",
    context: {
      claims: [
        buildClaim(PROJECT, {
          id: "rc2-a",
          atomic: "HIIT improves insulin sensitivity by 35% in adults over 60 after 12 weeks",
          scope: { population: "adults over 60" },
        }),
        buildClaim(PROJECT, {
          id: "rc2-b",
          atomic: "HIIT improves VO2max by 15% in adults over 60",
          scope: { population: "adults over 60" },
        }),
        buildClaim(PROJECT, {
          id: "rc2-c",
          atomic: "HIIT increases injury risk in sedentary adults over 65",
          scope: { population: "sedentary adults over 65" },
        }),
        buildClaim(PROJECT, {
          id: "rc2-d",
          atomic: "Moderate continuous training has similar insulin sensitivity gains with lower injury risk",
          scope: { population: "adults over 60" },
        }),
      ],
      episodes: [],
      contradictions: [],
    },
    expected: {
      supportingClaimIds: ["rc2-a", "rc2-c", "rc2-d"],
      finalAnswer: "HIIT improves insulin sensitivity in older adults but carries higher injury risk; moderate continuous training offers similar gains with better safety",
      minChainLength: 3,
    },
  },
];
