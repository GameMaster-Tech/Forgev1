/**
 * Demo context — assembled from the Sync + Pulse demo data so Lattice
 * has something to chew on out of the box. Mirrors the Series-A
 * Budget × Hiring scenario the rest of the workspace renders.
 */

import { buildDemoGraph } from "../sync/demo";
import { buildDemoBlocks } from "../pulse/demo";
import type { ProjectContext, ProjectDocument } from "./types";

const NOW = 1747200000000;

const DOCS: ProjectDocument[] = [
  {
    id: "doc.budget",
    title: "FY26 Operating Budget",
    updatedAt: NOW - 5 * 86400_000,
    body: [
      "## FY26 budget summary",
      "",
      "We plan to spend $720,000 on engineering payroll this year.",
      "Senior engineers earn $165,000 and juniors earn $120,000.",
      "",
      "## Runway",
      "",
      "At current burn we have 14 months of runway. Board mandate is 12.",
    ].join("\n"),
  },
  {
    id: "doc.hiring",
    title: "Engineering Hiring Plan",
    updatedAt: NOW - 3 * 86400_000,
    body: [
      "## Senior engineer job spec",
      "",
      "**Mission.** Lead end-to-end ownership of the verification graph.",
      "",
      "**Must-haves.** 5+ yrs production TS, distributed systems, on-call rotation.",
    ].join("\n"),
  },
  {
    id: "doc.roadmap",
    title: "Product Roadmap — H2 2026",
    updatedAt: NOW - 7 * 86400_000,
    body: [
      "## Launch timeline",
      "",
      "Beta ships 2026-09-15, GA on 2026-12-15.",
    ].join("\n"),
  },
];

export function buildDemoContext(): ProjectContext {
  const graph = buildDemoGraph();
  return {
    projectId: graph.projectId,
    assertions: graph.listAssertions(),
    documents: DOCS,
    blocks: buildDemoBlocks(),
    asOf: NOW,
  };
}

export const DEMO_PARENT_TASKS = [
  "Hire 4 senior engineers by 2026-09-01",
  "Launch beta of the Sync product by Sep 15",
  "Research competitive landscape for AI research tools",
  "Allocate budget for cloud infrastructure",
  "Draft the remote-work policy",
];
