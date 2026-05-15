/**
 * Forge Recall — grounded-refusal helper.
 *
 * The killer feature: when retrieval can't ground a factual question,
 * the AI is steered to ASK rather than HALLUCINATE.
 *
 * This module doesn't gate the model directly — it produces a small
 * structured signal the prompt builder embeds into the system prompt.
 * The model still produces the response; we just bias its template.
 *
 *   - pass=true  → "answer normally"
 *   - pass=false → "ask a clarifying question or say you don't know.
 *                   Do not fabricate."
 *
 * It's deliberately one knob, not twelve. Same idea as Claude/GPT's
 * "I don't have enough information" sometimes-behavior — except we
 * detect it deterministically and steer the response, instead of
 * hoping the RLHF caught the case.
 */

import type { RecallResult } from "./types";

export interface RefusalDirective {
  /** What to inject into the system prompt. Empty if pass. */
  instruction: string;
  /** Machine-readable so UI can render a "needs source" affordance. */
  shortfall?: {
    required: number;
    available: number;
  };
}

export function refusalFor(result: RecallResult): RefusalDirective {
  if (result.grounding.pass) return { instruction: "" };
  return {
    instruction: [
      "GROUNDING SHORTFALL.",
      `This question needs ${result.grounding.required} grounded source(s);`,
      `only ${result.grounding.available} are available in memory.`,
      "Do not fabricate. Either (a) ask the user a clarifying question,",
      "(b) explicitly flag the uncertainty in your response, or",
      "(c) request a source/document the user could pin.",
    ].join(" "),
    shortfall: {
      required: result.grounding.required,
      available: result.grounding.available,
    },
  };
}
