/**
 * Consultant template — independent or boutique consultant running
 * a discrete client engagement.
 */

import type { Template } from "./types";

const NOW = Date.now();
const DAY = 86_400_000;

export const CONSULTANT_TEMPLATE: Template = {
  key: "consultant",
  label: "Consultant",
  blurb: "Scope, time, deliverables — billable.",
  tone: "warm",
  why: "For management, strategy, and technical consultants. Forge tracks scope creep against the original SOW, hours billed against the budget, and every claim in the final deliverable against the source you cited it from.",
  project: {
    name: "Acme · Q3 Operating Review",
    description: "10-week engagement reviewing Acme's operating model.",
    mode: "reasoning",
  },
  assertions: [
    { id: "a.engagement.hours.budgeted", documentId: "doc.sow", key: "engagement.hours.budgeted", label: "Hours budgeted in SOW", kind: "budget.total", value: { type: "number", value: 320, unit: "hours" }, sourcedAt: NOW - 28 * DAY, source: "Signed SOW", confidence: 1.0, locked: true },
    { id: "a.engagement.hours.logged", documentId: "doc.sow", key: "engagement.hours.logged", label: "Hours logged to date", kind: "fact.numeric", value: { type: "number", value: 142, unit: "hours" }, sourcedAt: NOW - 1 * DAY, source: "Harvest export", confidence: 0.95 },
    { id: "a.rate.blended", documentId: "doc.sow", key: "engagement.rate.blended", label: "Blended hourly rate", kind: "rate.hourly", value: { type: "number", value: 285, unit: "USD/hr" }, sourcedAt: NOW - 28 * DAY, source: "Rate card 2026", confidence: 0.9 },
  ],
  documents: [
    { id: "doc.sow", title: "Statement of Work", type: "policy", assertionIds: ["a.engagement.hours.budgeted", "a.engagement.hours.logged", "a.rate.blended"] },
    { id: "doc.deliverable", title: "Final deliverable draft", type: "research-note", assertionIds: [] },
    { id: "doc.interviews", title: "Stakeholder interview notes", type: "research-note", assertionIds: [] },
  ],
  constraints: [
    {
      id: "c.hours.cap",
      from: "a.engagement.hours.logged",
      to: "a.engagement.hours.logged",
      kind: "less-than-or-equal",
      operand: 320,
      severity: "hard",
      rationale: "Logged hours must stay inside the SOW cap",
    },
  ],
  habits: [
    { id: "h.weekly-status", title: "Weekly client status email", rrule: "FREQ=WEEKLY;BYDAY=FR", durationMinutes: 30, energy: "shallow", timeZone: "America/New_York", streak: 0, createdAt: NOW },
    { id: "h.time-log", title: "Log hours daily", rrule: "FREQ=DAILY", durationMinutes: 5, energy: "shallow", timeZone: "America/New_York", streak: 0, createdAt: NOW },
  ],
  goals: [
    { id: "g.deliverable", title: "Ship final deliverable on time", targetDate: new Date(NOW + 42 * DAY).toISOString(), weeklyMinutesTarget: 30 * 60, loggedMinutes: 0, status: "active", createdAt: NOW },
  ],
};
