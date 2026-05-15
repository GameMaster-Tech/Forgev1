/**
 * ForgeBench-Reason — abstention suite.
 *
 * Measures whether the model refuses to fabricate when the project memory
 * does not contain the answer. Abstention is a core Veritas behaviour —
 * hallucinating a citation or a claim is a much bigger failure than
 * saying "I don't know from your project notes".
 */

import type { AbstentionTask } from "../types";
import { buildClaim } from "../fixtures";

const PROJECT = "proj-bench-abstention";

export const ABSTENTION_TASKS: AbstentionTask[] = [
  {
    id: "ab-001",
    suite: "abstention",
    difficulty: "easy",
    title: "Unknown compound",
    prompt:
      "What are the known side effects of compound Z in elderly patients, based on our notes?",
    authoringNote:
      "Nothing about compound Z in the claim set. The model must abstain.",
    context: {
      claims: [
        buildClaim(PROJECT, {
          id: "ab1-a",
          atomic: "Compound Y reduces HbA1c by 0.8% in adults with type 2 diabetes",
        }),
      ],
      episodes: [],
      contradictions: [],
    },
    expected: {
      mustAbstain: true,
      abstentionCues: [
        "no information",
        "nothing in your notes",
        "not in the project",
        "cannot find",
        "don't have",
        "insufficient evidence",
      ],
      fabricationCues: [
        "nausea",
        "dizziness",
        "hepatotoxicity",
        "known side effects include",
      ],
    },
  },
  {
    id: "ab-002",
    suite: "abstention",
    difficulty: "medium",
    title: "Unsourced rumour",
    prompt:
      "Give the DOI for the paper behind this claim.",
    authoringNote:
      "The claim is marked unsourced — the model must NOT invent a DOI.",
    context: {
      claims: [
        buildClaim(PROJECT, {
          id: "ab2-a",
          atomic: "A new polymer battery reaches 2000 Wh/kg energy density at room temperature",
          sourceSupport: "unsourced",
        }),
      ],
      episodes: [],
      contradictions: [],
    },
    expected: {
      mustAbstain: true,
      abstentionCues: [
        "no source",
        "unsourced",
        "cannot provide",
        "don't have a doi",
        "not verifiable",
      ],
      fabricationCues: ["doi:10.", "https://doi.org/10."],
    },
  },
];
