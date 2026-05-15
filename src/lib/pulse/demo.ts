/**
 * Demo content blocks — co-located with the Sync demo graph so Pulse's
 * page can show end-to-end refactor proposals immediately.
 */

import type { ContentBlock } from "./types";

export function buildDemoBlocks(): ContentBlock[] {
  return [
    {
      id: "block.budget.summary",
      documentId: "doc.budget",
      body:
        "## FY26 budget summary\n\n" +
        "We plan to spend $720,000 on engineering payroll this year. " +
        "Senior engineers earn $165,000 and juniors earn $120,000.",
      referencedAssertionIds: [
        "a.budget.payroll",
        "a.hiring.seniorSalary",
        "a.hiring.juniorSalary",
      ],
    },
    {
      id: "block.runway",
      documentId: "doc.budget",
      body:
        "## Runway\n\n" +
        "At current burn we have 14 months of runway. Board mandate is 12.",
      referencedAssertionIds: ["a.budget.runway"],
    },
    {
      id: "block.roadmap",
      documentId: "doc.roadmap",
      body:
        "## Launch timeline\n\n" +
        "Beta ships 2026-09-15, GA on 2026-12-15.",
      referencedAssertionIds: ["a.roadmap.beta", "a.roadmap.ga"],
    },
  ];
}
