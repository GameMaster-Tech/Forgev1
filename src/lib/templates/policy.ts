/**
 * Policy template — policy analyst at a think tank, government office,
 * or NGO.
 */

import type { Template } from "./types";

const NOW = Date.now();
const DAY = 86_400_000;

export const POLICY_TEMPLATE: Template = {
  key: "policy",
  label: "Policy analyst",
  blurb: "Brief, defend, cite — every claim traceable.",
  tone: "rose",
  why: "For policy researchers, regulatory analysts, government staff. Every claim in your brief is bound to its primary source; Pulse flags when underlying data drifts; Sync catches when your recommendation contradicts a stated constraint.",
  project: {
    name: "Brief · Regional climate funding",
    description: "Policy brief on Q4 climate funding allocation.",
    mode: "deep",
  },
  assertions: [
    { id: "a.budget.allocated", documentId: "doc.brief", key: "policy.budget.allocated", label: "Allocated budget", kind: "budget.total", value: { type: "number", value: 240_000_000, unit: "USD" }, sourcedAt: NOW - 21 * DAY, source: "Treasury bulletin 2026-Q3", confidence: 0.95, locked: true },
    { id: "a.beneficiaries", documentId: "doc.brief", key: "policy.beneficiaries.target", label: "Targeted beneficiaries", kind: "fact.numeric", value: { type: "number", value: 1_200_000, unit: "people" }, sourcedAt: NOW - 14 * DAY, source: "Programme charter", confidence: 0.7 },
    { id: "a.cost.perBeneficiary", documentId: "doc.brief", key: "policy.cost.perBeneficiary", label: "Cost per beneficiary", kind: "fact.numeric", value: { type: "number", value: 200, unit: "USD" }, sourcedAt: NOW - 14 * DAY, source: "Derived", confidence: 0.6 },
  ],
  documents: [
    { id: "doc.brief", title: "Policy brief — draft", type: "policy", assertionIds: ["a.budget.allocated", "a.beneficiaries", "a.cost.perBeneficiary"] },
    { id: "doc.sources", title: "Primary sources", type: "research-note", assertionIds: [] },
    { id: "doc.recommendations", title: "Recommendations", type: "policy", assertionIds: [] },
  ],
  constraints: [],
  habits: [
    { id: "h.morning-news", title: "Morning policy news scan", rrule: "FREQ=DAILY", durationMinutes: 20, energy: "shallow", timeZone: "America/New_York", streak: 0, createdAt: NOW },
  ],
  goals: [
    { id: "g.deliver-brief", title: "Deliver brief to stakeholders", targetDate: new Date(NOW + 30 * DAY).toISOString(), weeklyMinutesTarget: 15 * 60, loggedMinutes: 0, status: "active", createdAt: NOW },
  ],
};
