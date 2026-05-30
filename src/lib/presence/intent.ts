"use client";

/**
 * Intent prediction engine — turns a (possibly streaming/partial) utterance into
 * a `PredictedIntent` the Presence Layer can act on speculatively: a canonical
 * action, a target phrase, an optional route for cache-warming navigation, and a
 * confidence that rises as the utterance firms up.
 *
 * Deterministic + rule-based on purpose: it must run on every interim transcript
 * frame at zero latency. The model-backed agent (research/Tempo) is the source of
 * truth for *execution*; this engine is only for *prediction*, so the UI can lean
 * forward (prefetch, ghost-navigate) before speech ends.
 */

import { toConfidence, type PredictedIntent } from "./types";

const WAKE = /^\s*(hey\s+|ok\s+)?forge[,:]?\s*/i;

interface VerbSpec {
  action: PredictedIntent["action"];
  re: RegExp;
  weight: number;
}

const VERBS: VerbSpec[] = [
  { action: "navigate", re: /\b(open|go to|navigate to|show|take me to|jump to)\b/i, weight: 0.9 },
  { action: "create", re: /\b(create|make|new|add|draft|start)\b/i, weight: 0.85 },
  { action: "extract", re: /\b(extract|pull out|turn into|find all)\b/i, weight: 0.85 },
  { action: "assign", re: /\b(assign|give|hand)\b/i, weight: 0.8 },
  { action: "delete", re: /\b(delete|remove|archive|clear|trash)\b/i, weight: 0.9 },
  { action: "summarize", re: /\b(summari[sz]e|tl;?dr|recap)\b/i, weight: 0.8 },
  { action: "search", re: /\b(search|find|look up|where is)\b/i, weight: 0.8 },
];

/** Known destinations for speculative navigation + cache warming. */
const ROUTES: { re: RegExp; route: string; label: string }[] = [
  { re: /\b(projects?|workspaces?)\b/i, route: "/projects", label: "Projects" },
  { re: /\b(research|chat|ask)\b/i, route: "/research", label: "Research" },
  { re: /\b(calendar|schedule|tempo)\b/i, route: "/calendar", label: "Calendar" },
  { re: /\b(settings|preferences|appearance)\b/i, route: "/settings", label: "Settings" },
  { re: /\b(teams?)\b/i, route: "/teams", label: "Teams" },
  { re: /\b(activity|history)\b/i, route: "/activity", label: "Activity" },
];

const DESTRUCTIVE = new Set<PredictedIntent["action"]>(["delete"]);

export function isDestructive(action: PredictedIntent["action"]): boolean {
  return DESTRUCTIVE.has(action);
}

/**
 * Predict intent from a transcript. `partial=true` while the utterance is still
 * streaming — confidence is damped so we never over-commit on half a sentence.
 */
export function predictIntent(rawTranscript: string, partial: boolean): PredictedIntent {
  const transcript = rawTranscript.trim();
  const body = transcript.replace(WAKE, "").trim();
  const hadWake = WAKE.test(transcript);

  let action: PredictedIntent["action"] = "unknown";
  let verbWeight = 0;
  let verbEnd = 0;
  for (const v of VERBS) {
    const m = v.re.exec(body);
    if (m && m.index <= (verbEnd || Infinity)) {
      // Prefer the earliest, highest-weight verb.
      if (action === "unknown" || m.index < verbEnd || v.weight > verbWeight) {
        action = v.action;
        verbWeight = v.weight;
        verbEnd = m.index + m[0].length;
      }
    }
  }

  // Target phrase = everything after the matched verb (trimmed of filler).
  const targetPhrase =
    action !== "unknown"
      ? body.slice(verbEnd).replace(/^\s*(the|a|an|my|this|that)\s+/i, "").trim() || undefined
      : undefined;

  // Route for speculative navigation.
  const dest = ROUTES.find((r) => r.re.test(body));
  const route = action === "navigate" || action === "open" || action === "search" ? dest?.route : undefined;

  // Confidence model: verb match + a resolvable target/route + wake word, with a
  // damping factor while the transcript is still streaming.
  let score = 0;
  if (action !== "unknown") score += verbWeight * 0.55;
  if (targetPhrase) score += 0.25;
  if (route) score += 0.15;
  if (hadWake) score += 0.1;
  if (body.split(/\s+/).length >= 3) score += 0.05;
  if (partial) score *= 0.7;
  score = Math.min(1, score);

  const label = buildLabel(action, targetPhrase, dest?.label);

  return {
    action,
    label,
    targetPhrase,
    route,
    confidence: toConfidence(score),
    partial,
    transcript,
  };
}

function buildLabel(
  action: PredictedIntent["action"],
  target?: string,
  destLabel?: string,
): string {
  const t = target ? `"${truncate(target, 40)}"` : destLabel ?? "";
  switch (action) {
    case "navigate":
    case "open":
      return `Opening ${t || "…"}`.trim();
    case "create":
      return `Creating ${t || "…"}`.trim();
    case "extract":
      return `Extracting ${t || "…"}`.trim();
    case "assign":
      return `Assigning ${t || "…"}`.trim();
    case "delete":
      return `Removing ${t || "…"}`.trim();
    case "summarize":
      return `Summarizing ${t || "…"}`.trim();
    case "search":
      return `Searching ${t || "…"}`.trim();
    default:
      return "Listening…";
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
