/**
 * ForgeBench-Reason — contra-detect suite.
 *
 * Measures the model's ability to flag genuine contradictions while
 * resisting scope-disagreement decoys (two claims that LOOK contradictory
 * but are about different populations / doses / settings, and therefore
 * both hold).
 *
 * This suite is the single biggest differentiator between Veritas-R1 and a
 * generic LLM — decoy-resistance is where the structured `ClaimScope` field
 * earns its keep at inference time.
 */

import type { ContraDetectTask } from "../types";
import { buildClaim, buildContradiction } from "../fixtures";

const PROJECT = "proj-bench-contra";

export const CONTRA_DETECT_TASKS: ContraDetectTask[] = [
  /* ───── Easy: direct polarity flip, same scope ───── */
  {
    id: "cd-001",
    suite: "contra-detect",
    difficulty: "easy",
    title: "Direct polarity flip — mortality claim",
    prompt:
      "Review the claims below. Which pairs contradict each other? Return the claim id pairs.",
    authoringNote:
      "Gold pair {cd1-a, cd1-b}: clean opposite-polarity on the same scope.",
    context: {
      claims: [
        buildClaim(PROJECT, {
          id: "cd1-a",
          atomic: "GLP-1 agonists reduce all-cause mortality in type 2 diabetics",
          scope: { population: "type 2 diabetics" },
        }),
        buildClaim(PROJECT, {
          id: "cd1-b",
          atomic: "GLP-1 agonists do not reduce all-cause mortality in type 2 diabetics",
          polarity: "negates",
          scope: { population: "type 2 diabetics" },
        }),
        buildClaim(PROJECT, {
          id: "cd1-c",
          atomic: "Metformin is the first-line therapy for type 2 diabetes",
          scope: { population: "type 2 diabetics" },
        }),
      ],
      episodes: [],
      contradictions: [],
    },
    expected: {
      pairs: [["cd1-a", "cd1-b"]],
      decoys: [],
    },
  },

  /* ───── Medium: decoy — scope disagrees (population) ───── */
  {
    id: "cd-002",
    suite: "contra-detect",
    difficulty: "medium",
    title: "Scope disagrees — population",
    prompt:
      "Review the claims below. Which pairs are true contradictions (hold over the same scope)?",
    authoringNote:
      "No real contradiction — cd2-a is about mice, cd2-b is about humans. A naive detector will flag them.",
    context: {
      claims: [
        buildClaim(PROJECT, {
          id: "cd2-a",
          atomic: "Compound X reduces tumour volume by 40%",
          scope: { population: "mice C57BL/6", setting: "in-vivo" },
        }),
        buildClaim(PROJECT, {
          id: "cd2-b",
          atomic: "Compound X does not reduce tumour volume",
          polarity: "negates",
          scope: { population: "adult humans", setting: "clinical-trial" },
        }),
      ],
      episodes: [],
      contradictions: [],
    },
    expected: {
      pairs: [],
      decoys: [["cd2-a", "cd2-b"]],
    },
  },

  /* ───── Medium: dose-scope decoy ───── */
  {
    id: "cd-003",
    suite: "contra-detect",
    difficulty: "medium",
    title: "Dose-scope decoy",
    prompt:
      "Review the claims. Flag contradictions that hold over the same dose.",
    authoringNote:
      "cd3-a@10mg/kg and cd3-b@1mg/kg are both plausible dose-response observations.",
    context: {
      claims: [
        buildClaim(PROJECT, {
          id: "cd3-a",
          atomic: "Drug Y suppresses IL-6 by 60% in healthy volunteers",
          scope: { population: "healthy volunteers", dose: "10 mg/kg" },
        }),
        buildClaim(PROJECT, {
          id: "cd3-b",
          atomic: "Drug Y does not suppress IL-6 in healthy volunteers",
          polarity: "negates",
          scope: { population: "healthy volunteers", dose: "1 mg/kg" },
        }),
      ],
      episodes: [],
      contradictions: [],
    },
    expected: {
      pairs: [],
      decoys: [["cd3-a", "cd3-b"]],
    },
  },

  /* ───── Hard: direction reversal + overlapping scope ───── */
  {
    id: "cd-004",
    suite: "contra-detect",
    difficulty: "hard",
    title: "Direction reversal — same scope",
    prompt:
      "Identify the contradicting pair.",
    authoringNote:
      "cd4-a claims LDL DECREASE at 20mg; cd4-b claims LDL INCREASE at the same dose in the same population. Gold pair.",
    context: {
      claims: [
        buildClaim(PROJECT, {
          id: "cd4-a",
          atomic: "Statin Z lowers LDL cholesterol by 32% in adults over 50",
          scope: { population: "adults over 50", dose: "20 mg" },
        }),
        buildClaim(PROJECT, {
          id: "cd4-b",
          atomic: "Statin Z raises LDL cholesterol by 18% in adults over 50",
          scope: { population: "adults over 50", dose: "20 mg" },
        }),
        buildClaim(PROJECT, {
          id: "cd4-c",
          atomic: "Statin Z reduces cardiovascular events by 20%",
          scope: { population: "adults over 50" },
        }),
      ],
      episodes: [],
      contradictions: [
        buildContradiction(PROJECT, {
          id: "ctd-cd4",
          a: "cd4-a",
          b: "cd4-b",
          signals: ["direction-reversal", "opposite-polarity"],
          score: 0.92,
        }),
      ],
    },
    expected: {
      pairs: [["cd4-a", "cd4-b"]],
      decoys: [],
    },
  },

  /* ───── Hard: three-way (two real contradictions + one decoy) ───── */
  {
    id: "cd-005",
    suite: "contra-detect",
    difficulty: "hard",
    title: "Three-way — two reals, one decoy",
    prompt:
      "Return every pair of claims that truly contradict over the same scope.",
    authoringNote:
      "Real: {cd5-a, cd5-b} (dose same, polarity flip) and {cd5-c, cd5-d} (magnitude reversal). Decoy: {cd5-a, cd5-e} (different population).",
    context: {
      claims: [
        buildClaim(PROJECT, {
          id: "cd5-a",
          atomic: "Compound K inhibits kinase activity",
          scope: { population: "adults", dose: "5 mg/kg" },
        }),
        buildClaim(PROJECT, {
          id: "cd5-b",
          atomic: "Compound K does not inhibit kinase activity",
          polarity: "negates",
          scope: { population: "adults", dose: "5 mg/kg" },
        }),
        buildClaim(PROJECT, {
          id: "cd5-c",
          atomic: "Treatment T reduces recovery time by 15 days",
          scope: { population: "post-op patients" },
        }),
        buildClaim(PROJECT, {
          id: "cd5-d",
          atomic: "Treatment T reduces recovery time by 2 days",
          scope: { population: "post-op patients" },
        }),
        buildClaim(PROJECT, {
          id: "cd5-e",
          atomic: "Compound K does not inhibit kinase activity",
          polarity: "negates",
          scope: { population: "paediatric", dose: "5 mg/kg" },
        }),
      ],
      episodes: [],
      contradictions: [],
    },
    expected: {
      pairs: [
        ["cd5-a", "cd5-b"],
        ["cd5-c", "cd5-d"],
      ],
      decoys: [["cd5-a", "cd5-e"]],
    },
  },
];
