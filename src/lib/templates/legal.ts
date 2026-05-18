/**
 * Legal template — in-house counsel or solo practitioner running an
 * active matter.
 */

import type { Template } from "./types";

const NOW = Date.now();
const DAY = 86_400_000;

export const LEGAL_TEMPLATE: Template = {
  key: "legal",
  label: "Legal counsel",
  blurb: "Matter, hours, exhibits — argument-ready.",
  tone: "green",
  why: "For in-house counsel, solo practitioners, and litigators. Forge tracks every factual claim in your brief against the exhibit you cited, every billable hour against the matter budget, and every deadline against the controlling rule.",
  project: {
    name: "Matter · Acme v. Forge LLC",
    description: "Active commercial dispute matter.",
    mode: "deep",
  },
  assertions: [
    { id: "a.matter.hours.budget", documentId: "doc.matter", key: "matter.hours.budget", label: "Matter hours budget", kind: "budget.total", value: { type: "number", value: 480, unit: "hours" }, sourcedAt: NOW - 60 * DAY, source: "Engagement letter", confidence: 1.0, locked: true },
    { id: "a.matter.hours.logged", documentId: "doc.matter", key: "matter.hours.logged", label: "Hours logged", kind: "fact.numeric", value: { type: "number", value: 188, unit: "hours" }, sourcedAt: NOW - 1 * DAY, source: "Timekeeping system", confidence: 0.95 },
    { id: "a.deadline.discovery", documentId: "doc.matter", key: "matter.deadline.discovery", label: "Discovery deadline", kind: "timeline.deadline", value: { type: "date", value: new Date(NOW + 25 * DAY).toISOString().slice(0, 10) }, sourcedAt: NOW - 30 * DAY, source: "Court order 04/22", confidence: 1.0, locked: true },
  ],
  documents: [
    { id: "doc.matter", title: "Matter dashboard", type: "policy", assertionIds: ["a.matter.hours.budget", "a.matter.hours.logged", "a.deadline.discovery"] },
    { id: "doc.brief", title: "Reply brief — draft", type: "research-note", assertionIds: [] },
    { id: "doc.exhibits", title: "Exhibit register", type: "research-note", assertionIds: [] },
  ],
  constraints: [
    {
      id: "c.hours.cap",
      from: "a.matter.hours.logged",
      to: "a.matter.hours.logged",
      kind: "less-than-or-equal",
      operand: 480,
      severity: "hard",
      rationale: "Logged hours must stay within the matter budget",
    },
  ],
  habits: [
    { id: "h.timekeeping", title: "Contemporaneous timekeeping", rrule: "FREQ=DAILY", durationMinutes: 10, energy: "shallow", timeZone: "America/New_York", streak: 0, createdAt: NOW },
  ],
  goals: [
    { id: "g.discovery", title: "Complete discovery on schedule", targetDate: new Date(NOW + 25 * DAY).toISOString(), weeklyMinutesTarget: 25 * 60, loggedMinutes: 0, status: "active", createdAt: NOW },
  ],
};
