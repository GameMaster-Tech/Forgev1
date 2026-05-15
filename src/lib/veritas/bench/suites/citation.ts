/**
 * ForgeBench-Reason — citation suite.
 *
 * Measures whether the model pairs an assertion with the CORRECT DOI, not
 * a plausible-looking fabrication. This suite is the one place we accept
 * zero partial credit — a wrong DOI is worse than no DOI.
 *
 * DOIs used here are real published papers whose topics match the claim.
 * If any of these get retracted between now and the eval run, the ground
 * truth should be updated.
 */

import type { CitationTask } from "../types";
import { buildClaim } from "../fixtures";

const PROJECT = "proj-bench-citation";

export const CITATION_TASKS: CitationTask[] = [
  {
    id: "ci-001",
    suite: "citation",
    difficulty: "easy",
    title: "Landmark statin trial — 4S",
    prompt:
      "Give the DOI of the paper most commonly cited for the conclusion that simvastatin reduces all-cause mortality in patients with coronary heart disease.",
    context: {
      claims: [
        buildClaim(PROJECT, {
          id: "ci1-a",
          atomic: "Simvastatin reduces all-cause mortality in patients with coronary heart disease",
        }),
      ],
      episodes: [],
      contradictions: [],
    },
    expected: {
      // Scandinavian Simvastatin Survival Study (4S), The Lancet 1994
      doi: "10.1016/s0140-6736(94)90566-5",
      acceptedAlternates: ["10.1016/0140-6736(94)90566-5"],
    },
  },
  {
    id: "ci-002",
    suite: "citation",
    difficulty: "medium",
    title: "CRISPR-Cas9 founding paper",
    prompt:
      "Provide the DOI of the 2012 Jinek et al. paper describing programmable CRISPR-Cas9 for targeted DNA cleavage.",
    context: {
      claims: [
        buildClaim(PROJECT, {
          id: "ci2-a",
          atomic: "CRISPR-Cas9 can be programmed with a single guide RNA for site-specific DNA cleavage",
        }),
      ],
      episodes: [],
      contradictions: [],
    },
    expected: {
      doi: "10.1126/science.1225829",
    },
  },
];
