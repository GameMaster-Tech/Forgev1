/**
 * Demo fixture — a realistic Budget vs Hiring paradox a Series-A
 * researcher might face. The UI uses this when no live workspace data
 * is wired yet, so the page is never empty.
 */

import { DependencyGraph } from "./graph";
import type { Assertion, ConstraintEdge, DocumentNode } from "./types";

const PROJECT_ID = "demo-project";
const NOW = 1747200000000; // 2026-05-14T00:00:00Z, deterministic

export function buildDemoGraph(): DependencyGraph {
  const g = new DependencyGraph(PROJECT_ID);

  const docs: DocumentNode[] = [
    { id: "doc.budget", projectId: PROJECT_ID, title: "FY26 Operating Budget", type: "budget", assertionIds: [] },
    { id: "doc.hiring", projectId: PROJECT_ID, title: "Engineering Hiring Plan", type: "hiring-plan", assertionIds: [] },
    { id: "doc.roadmap", projectId: PROJECT_ID, title: "Product Roadmap — H2 2026", type: "roadmap", assertionIds: [] },
  ];
  for (const d of docs) g.upsertDocument(d);

  const A: Assertion[] = [
    // Budget
    { id: "a.budget.payroll", projectId: PROJECT_ID, documentId: "doc.budget", key: "budget.payroll.annual", label: "Annual payroll budget", kind: "budget.total", value: { type: "number", value: 720_000, unit: "USD" }, sourcedAt: NOW - 60 * 86400_000, source: "Board pre-read Apr 2026", confidence: 0.9, locked: true },
    { id: "a.budget.runway", projectId: PROJECT_ID, documentId: "doc.budget", key: "runway.months", label: "Cash runway", kind: "runway.months", value: { type: "number", value: 14, unit: "months" }, sourcedAt: NOW - 30 * 86400_000, source: "CFO model v3", confidence: 0.78 },

    // Hiring — counts & salaries (tracked by Pulse for decay)
    { id: "a.hiring.seniorCount", projectId: PROJECT_ID, documentId: "doc.hiring", key: "engineering.senior.headcount", label: "Senior engineers to hire", kind: "headcount", value: { type: "number", value: 4, unit: "people" }, sourcedAt: NOW - 14 * 86400_000, source: "Hiring plan v2", confidence: 0.85 },
    { id: "a.hiring.seniorSalary", projectId: PROJECT_ID, documentId: "doc.hiring", key: "engineering.senior.salary", label: "Senior engineer salary (annual)", kind: "salary.annual", value: { type: "number", value: 165_000, unit: "USD" }, sourcedAt: NOW - 180 * 86400_000, source: "Comp ladder Nov 2025", confidence: 0.55 },
    { id: "a.hiring.juniorCount", projectId: PROJECT_ID, documentId: "doc.hiring", key: "engineering.junior.headcount", label: "Junior engineers to hire", kind: "headcount", value: { type: "number", value: 1, unit: "people" }, sourcedAt: NOW - 14 * 86400_000, source: "Hiring plan v2", confidence: 0.85 },
    { id: "a.hiring.juniorSalary", projectId: PROJECT_ID, documentId: "doc.hiring", key: "engineering.junior.salary", label: "Junior engineer salary (annual)", kind: "salary.annual", value: { type: "number", value: 120_000, unit: "USD" }, sourcedAt: NOW - 180 * 86400_000, source: "Comp ladder Nov 2025", confidence: 0.55 },

    // Hiring — derived line-item totals (count × salary). These are what
    // the payroll constraint actually sums. Low confidence — they were
    // hand-typed in the hiring memo, not computed live.
    { id: "a.hiring.seniorTotalComp", projectId: PROJECT_ID, documentId: "doc.hiring", key: "engineering.senior.totalComp", label: "Senior line-item (count × salary)", kind: "budget.lineitem", value: { type: "number", value: 660_000, unit: "USD" }, sourcedAt: NOW - 14 * 86400_000, source: "Hiring plan v2", confidence: 0.6 },
    { id: "a.hiring.juniorTotalComp", projectId: PROJECT_ID, documentId: "doc.hiring", key: "engineering.junior.totalComp", label: "Junior line-item (count × salary)", kind: "budget.lineitem", value: { type: "number", value: 120_000, unit: "USD" }, sourcedAt: NOW - 14 * 86400_000, source: "Hiring plan v2", confidence: 0.6 },

    // Roadmap — implied requirements
    { id: "a.roadmap.beta", projectId: PROJECT_ID, documentId: "doc.roadmap", key: "milestone.beta", label: "Beta launch", kind: "timeline.deadline", value: { type: "date", value: "2026-09-15" }, sourcedAt: NOW - 7 * 86400_000, source: "Roadmap v4", confidence: 0.8 },
    { id: "a.roadmap.ga", projectId: PROJECT_ID, documentId: "doc.roadmap", key: "milestone.ga", label: "GA launch", kind: "timeline.deadline", value: { type: "date", value: "2026-12-15" }, sourcedAt: NOW - 7 * 86400_000, source: "Roadmap v4", confidence: 0.7 },
  ];
  for (const a of A) g.upsertAssertion(a);

  const C: ConstraintEdge[] = [
    // Hiring × salary ≤ payroll budget. Modelled as a less-than-or-equal
    // on payroll, with operand computed from the sum (we use sum-equals
    // here so the rebalancer can fix `juniorSalary` or `seniorCount`).
    {
      id: "c.payroll.sum",
      projectId: PROJECT_ID,
      from: ["a.hiring.seniorTotalComp", "a.hiring.juniorTotalComp"],
      to: "a.budget.payroll",
      kind: "less-than-or-equal",
      operand: 720_000,
      tolerance: 0.02,
      severity: "hard",
      rationale: "Total compensation must fit inside the locked payroll budget",
    },
    // Runway must be at least 12 months at all times.
    {
      id: "c.runway.floor",
      projectId: PROJECT_ID,
      from: "a.budget.runway",
      to: "a.budget.runway",
      kind: "greater-than-or-equal",
      operand: 12,
      severity: "hard",
      rationale: "Board mandate: never drop below 12 months runway",
    },
    // Beta must precede GA.
    {
      id: "c.timeline.order",
      projectId: PROJECT_ID,
      from: "a.roadmap.beta",
      to: "a.roadmap.ga",
      kind: "less-than-or-equal",
      severity: "hard",
      rationale: "Beta must ship before GA",
    },
    // Senior salary should land inside the 2026 market band.
    {
      id: "c.salary.market.senior",
      projectId: PROJECT_ID,
      from: "a.hiring.seniorSalary",
      to: "a.hiring.seniorSalary",
      kind: "greater-than-or-equal",
      operand: 205_000,
      severity: "soft",
      rationale: "Senior engineer comp must sit inside the May-2026 market band",
    },
  ];
  for (const c of C) g.upsertConstraint(c);

  return g;
}
