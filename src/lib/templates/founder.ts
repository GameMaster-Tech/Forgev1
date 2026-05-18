/**
 * Founder template — Series-A founder running a startup. Mirrors the
 * existing demo data so users coming from `/sync` and `/pulse` recognise
 * the shape immediately, with a tighter narrative.
 */

import type { Template } from "./types";

const NOW = Date.now();
const DAY = 86_400_000;

export const FOUNDER_TEMPLATE: Template = {
  key: "founder",
  label: "Founder",
  blurb: "Budget, hiring, fundraise — one compiled workspace.",
  tone: "violet",
  why: "For seed-to-Series-B founders. Forge tracks runway, payroll, hiring pipeline, and investor commitments as interconnected variables — Sync surfaces when they contradict, Pulse keeps the numbers current.",
  project: {
    name: "Series A · ops",
    description: "Operating workspace for the next 18 months.",
    mode: "reasoning",
  },
  assertions: [
    { id: "a.budget.payroll", documentId: "doc.budget", key: "budget.payroll.annual", label: "Annual payroll budget", kind: "budget.total", value: { type: "number", value: 720_000, unit: "USD" }, sourcedAt: NOW - 60 * DAY, source: "Board pre-read", confidence: 0.9, locked: true },
    { id: "a.budget.runway", documentId: "doc.budget", key: "runway.months", label: "Cash runway", kind: "runway.months", value: { type: "number", value: 14, unit: "months" }, sourcedAt: NOW - 30 * DAY, source: "CFO model v3", confidence: 0.78 },
    { id: "a.hiring.seniorTotalComp", documentId: "doc.hiring", key: "engineering.senior.totalComp", label: "Senior line-item (count × salary)", kind: "budget.lineitem", value: { type: "number", value: 660_000, unit: "USD" }, sourcedAt: NOW - 14 * DAY, source: "Hiring plan v2", confidence: 0.6 },
    { id: "a.hiring.juniorTotalComp", documentId: "doc.hiring", key: "engineering.junior.totalComp", label: "Junior line-item (count × salary)", kind: "budget.lineitem", value: { type: "number", value: 120_000, unit: "USD" }, sourcedAt: NOW - 14 * DAY, source: "Hiring plan v2", confidence: 0.6 },
  ],
  documents: [
    { id: "doc.budget", title: "FY26 Operating Budget", type: "budget", assertionIds: ["a.budget.payroll", "a.budget.runway"] },
    { id: "doc.hiring", title: "Engineering Hiring Plan", type: "hiring-plan", assertionIds: ["a.hiring.seniorTotalComp", "a.hiring.juniorTotalComp"] },
    { id: "doc.roadmap", title: "Product Roadmap — H2 2026", type: "roadmap", assertionIds: [] },
  ],
  constraints: [
    {
      id: "c.payroll.sum",
      from: ["a.hiring.seniorTotalComp", "a.hiring.juniorTotalComp"],
      to: "a.budget.payroll",
      kind: "less-than-or-equal",
      operand: 720_000,
      tolerance: 0.02,
      severity: "hard",
      rationale: "Total compensation must fit inside the locked payroll budget",
    },
    {
      id: "c.runway.floor",
      from: "a.budget.runway",
      to: "a.budget.runway",
      kind: "greater-than-or-equal",
      operand: 12,
      severity: "hard",
      rationale: "Board mandate: never drop below 12 months runway",
    },
  ],
  habits: [
    { id: "h.weekly-review", title: "Friday weekly review", rrule: "FREQ=WEEKLY;BYDAY=FR", durationMinutes: 30, energy: "shallow", timeZone: "America/New_York", streak: 0, createdAt: NOW },
    { id: "h.investor-update", title: "Monthly investor update", rrule: "FREQ=MONTHLY;BYMONTHDAY=1", durationMinutes: 60, energy: "creative", timeZone: "America/New_York", streak: 0, createdAt: NOW },
  ],
  goals: [
    { id: "g.close-seed", title: "Close $5M seed extension", targetDate: new Date(NOW + 75 * DAY).toISOString(), weeklyMinutesTarget: 6 * 60, loggedMinutes: 0, status: "active", createdAt: NOW },
    { id: "g.hire-senior", title: "Hire 4 senior engineers", targetDate: new Date(NOW + 90 * DAY).toISOString(), weeklyMinutesTarget: 4 * 60, loggedMinutes: 0, status: "active", createdAt: NOW },
  ],
};
