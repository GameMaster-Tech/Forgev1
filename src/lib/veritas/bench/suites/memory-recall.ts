/**
 * ForgeBench-Reason — memory-recall suite.
 *
 * Measures whether the model pulls the RIGHT prior claims / episodes when
 * the user asks a question whose answer lives in project memory. This is
 * the "our AI remembers what you've already shown it" capability.
 */

import type { MemoryRecallTask } from "../types";
import { buildClaim, buildEpisode } from "../fixtures";

const PROJECT = "proj-bench-memory";

export const MEMORY_RECALL_TASKS: MemoryRecallTask[] = [
  {
    id: "mr-001",
    suite: "memory-recall",
    difficulty: "easy",
    title: "Single-claim recall",
    prompt:
      "What did we conclude earlier about the effect of compound X on inflammation markers?",
    context: {
      claims: [
        buildClaim(PROJECT, {
          id: "mr1-a",
          atomic: "Compound X reduces CRP levels by 45% in early-phase trials",
        }),
        buildClaim(PROJECT, {
          id: "mr1-b",
          atomic: "Aspirin is commonly used as an anti-platelet agent",
        }),
      ],
      episodes: [
        buildEpisode(PROJECT, {
          id: "epi-mr1",
          type: "query",
          input: "Effect of compound X on inflammation?",
          output: "Reduces CRP by 45%.",
          claimsReferenced: ["mr1-a"],
        }),
      ],
      contradictions: [],
    },
    expected: {
      mustRecallClaimIds: ["mr1-a"],
      mustRecallEpisodeIds: ["epi-mr1"],
    },
  },
  {
    id: "mr-002",
    suite: "memory-recall",
    difficulty: "medium",
    title: "Multi-claim recall across topics",
    prompt:
      "Summarise what we know so far about ketogenic diets and seizure frequency.",
    context: {
      claims: [
        buildClaim(PROJECT, {
          id: "mr2-a",
          atomic: "Ketogenic diet reduces seizure frequency by 50% in paediatric refractory epilepsy",
          scope: { population: "paediatric refractory epilepsy" },
        }),
        buildClaim(PROJECT, {
          id: "mr2-b",
          atomic: "Modified Atkins produces comparable ketosis with better adherence than classic KD",
        }),
        buildClaim(PROJECT, {
          id: "mr2-c",
          atomic: "Long-term ketogenic diet is associated with dyslipidaemia",
        }),
        buildClaim(PROJECT, {
          id: "mr2-d",
          atomic: "Gut microbiome composition differs between responders and non-responders to KD",
        }),
        buildClaim(PROJECT, {
          id: "mr2-e",
          atomic: "Vitamin D deficiency is common in urban adolescents",
        }),
      ],
      episodes: [],
      contradictions: [],
    },
    expected: {
      mustRecallClaimIds: ["mr2-a", "mr2-b", "mr2-c", "mr2-d"],
    },
  },
  {
    id: "mr-003",
    suite: "memory-recall",
    difficulty: "hard",
    title: "Recall with distractors",
    prompt:
      "Earlier I asked about statin-induced myopathy. What did we find?",
    authoringNote:
      "Only mr3-b is relevant. All other claims are on statins but on different effects.",
    context: {
      claims: [
        buildClaim(PROJECT, {
          id: "mr3-a",
          atomic: "Statins reduce LDL-C by 30-55% in a dose-dependent manner",
        }),
        buildClaim(PROJECT, {
          id: "mr3-b",
          atomic: "Statin-induced myopathy occurs in 1-5% of treated patients",
        }),
        buildClaim(PROJECT, {
          id: "mr3-c",
          atomic: "Statins reduce major cardiovascular events by ~25% per mmol/L LDL reduction",
        }),
        buildClaim(PROJECT, {
          id: "mr3-d",
          atomic: "Rosuvastatin has the highest LDL-C lowering potency among marketed statins",
        }),
      ],
      episodes: [
        buildEpisode(PROJECT, {
          id: "epi-mr3-prior",
          type: "query",
          input: "Incidence of statin myopathy?",
          output: "1-5%.",
          claimsReferenced: ["mr3-b"],
        }),
      ],
      contradictions: [],
    },
    expected: {
      mustRecallClaimIds: ["mr3-b"],
      mustRecallEpisodeIds: ["epi-mr3-prior"],
    },
  },
];
