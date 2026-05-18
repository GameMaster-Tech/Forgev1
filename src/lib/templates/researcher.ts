/**
 * Researcher template — academic / independent researcher running a
 * paper or grant cycle.
 */

import type { Template } from "./types";

const NOW = Date.now();
const DAY = 86_400_000;

export const RESEARCHER_TEMPLATE: Template = {
  key: "researcher",
  label: "Researcher",
  blurb: "Track claims, sources, and the deadline that ends everything.",
  tone: "cyan",
  why: "For academics, PhD students, independent researchers. Forge tracks every claim you make against its citation, every result against its dataset, and every deadline against the work it requires.",
  project: {
    name: "Submission · NeurIPS 2026",
    description: "Paper + supporting experiments for the December submission cycle.",
    mode: "deep",
  },
  assertions: [
    { id: "a.deadline.submit", documentId: "doc.proposal", key: "milestone.submission", label: "Paper submission deadline", kind: "timeline.deadline", value: { type: "date", value: new Date(NOW + 45 * DAY).toISOString().slice(0, 10) }, sourcedAt: NOW, source: "Conference site", confidence: 0.99, locked: true },
    { id: "a.compute.budget", documentId: "doc.proposal", key: "budget.compute.usd", label: "GPU budget remaining", kind: "budget.total", value: { type: "number", value: 8_400, unit: "USD" }, sourcedAt: NOW - 7 * DAY, source: "Lambda Labs invoice", confidence: 0.85 },
    { id: "a.metric.baseline", documentId: "doc.results", key: "metric.baseline.accuracy", label: "Baseline accuracy", kind: "fact.numeric", value: { type: "number", value: 73.2, unit: "percent" }, sourcedAt: NOW - 14 * DAY, source: "Run 042", confidence: 0.75 },
  ],
  documents: [
    { id: "doc.proposal", title: "Proposal & abstract", type: "research-note", assertionIds: ["a.deadline.submit", "a.compute.budget"] },
    { id: "doc.results", title: "Results & ablations", type: "research-note", assertionIds: ["a.metric.baseline"] },
    { id: "doc.relatedwork", title: "Related work", type: "research-note", assertionIds: [] },
  ],
  constraints: [],
  habits: [
    { id: "h.reading", title: "Read 30 pages of related work", rrule: "FREQ=DAILY", durationMinutes: 45, energy: "creative", timeZone: "America/New_York", streak: 0, createdAt: NOW },
    { id: "h.lab-notebook", title: "Update lab notebook", rrule: "FREQ=DAILY", durationMinutes: 15, energy: "shallow", timeZone: "America/New_York", streak: 0, createdAt: NOW },
  ],
  goals: [
    { id: "g.submit", title: "Submit to NeurIPS 2026", targetDate: new Date(NOW + 45 * DAY).toISOString(), weeklyMinutesTarget: 20 * 60, loggedMinutes: 0, status: "active", createdAt: NOW },
  ],
};
