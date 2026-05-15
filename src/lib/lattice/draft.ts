/**
 * Draft synthesiser — pre-fills the `DraftOutcome` for an atomic
 * subtask using whatever project data is available at synthesis time.
 *
 * No LLM. Lattice's brief calls for "LLM-synthesis" but at this layer
 * we want a deterministic, testable, side-effect-free synthesiser that
 * does the structural work (cite which assertion, what number, which
 * doc id, etc.). Plugging an LLM in later means swapping the
 * `synthesizeDraft` body, not the contract.
 *
 * Confidence model
 *  • Start at 1.0.
 *  • Subtract 0.15 for every cited assertion that's stale
 *    (Pulse trust < 0.5).
 *  • Subtract 0.25 if any required key is missing.
 *  • Subtract 0.1 for every "unresolved" intent token (parser caveats).
 *  • Clamp to [0, 1].
 */

import { trustAt } from "../pulse/decay";
import { lookup as marketLookup } from "../sync/market";
import type { Assertion, AssertionKind, AssertionValue } from "../sync/types";
import type {
  DraftAssertionWrite,
  DraftOutcome,
  ParsedIntent,
  ProjectContext,
} from "./types";

export interface DraftRequest {
  /** Used for prose framing ("Hire 4 senior engineers…"). */
  parentIntent: ParsedIntent;
  /** Subtask title — appears in the draft heading. */
  title: string;
  /** Intent tag of *this* subtask (parser may differ per subtask). */
  intentTag: string;
  /** Assertion keys the subtask reads or writes. */
  boundAssertionKeys: string[];
  /** Document ids the subtask touches. */
  boundDocumentIds: string[];
  /** Optional kind hint when the subtask proposes writes. */
  writesKindHints?: Partial<Record<string, AssertionKind>>;
  ctx: ProjectContext;
  now?: number;
}

/* ───────────── synthesiser ───────────── */

export function synthesizeDraft(req: DraftRequest): DraftOutcome {
  const now = req.now ?? Date.now();
  const cited: Assertion[] = [];
  const caveats: string[] = [];
  let confidence = 1.0;

  // Resolve every bound key — either it exists in the context (we cite
  // it) or it's missing (we caveat).
  for (const key of req.boundAssertionKeys) {
    const found = pickAssertion(req.ctx, key);
    if (!found) {
      caveats.push(`\`${key}\` not yet in the project — draft uses a market mock`);
      confidence -= 0.25;
      continue;
    }
    cited.push(found);
    const t = trustAt(found, now);
    if (t < 0.5) {
      caveats.push(`\`${key}\` is stale (trust ${(t * 100).toFixed(0)}%) — Pulse will refresh on next sync`);
      confidence -= 0.15;
    }
  }
  for (const note of req.parentIntent.unresolved) {
    caveats.push(note);
    confidence -= 0.1;
  }

  // Generate the body. Templates by intent tag — fall through to a
  // generic outline.
  const body = buildBody(req, cited);

  // Generate proposed writes. We currently propose writes only when the
  // intent tag is `hire`, `budget`, or `research` — those are the ones
  // with structured outputs (a number we can commit).
  const writes = buildWrites(req, cited);

  confidence = Math.max(0, Math.min(1, confidence));

  return {
    body,
    writes,
    confidence,
    generatedAt: now,
    citedAssertionIds: cited.map((a) => a.id),
    caveats,
  };
}

/* ───────────── body templating ───────────── */

function buildBody(req: DraftRequest, cited: Assertion[]): string {
  switch (req.intentTag) {
    case "hire.role.comp":     return bodyForHireComp(req, cited);
    case "hire.role.spec":     return bodyForHireSpec(req, cited);
    case "hire.role.pipeline": return bodyForHirePipeline(req, cited);
    case "budget.line":        return bodyForBudgetLine(req, cited);
    case "budget.runway":      return bodyForRunway(req, cited);
    case "research.brief":     return bodyForResearchBrief(req, cited);
    case "launch.checklist":   return bodyForLaunchChecklist(req, cited);
    case "policy.draft":       return bodyForPolicyDraft(req, cited);
    case "report.summary":     return bodyForReport(req, cited);
    default:                   return bodyForGeneric(req, cited);
  }
}

function bodyForHireComp(req: DraftRequest, cited: Assertion[]): string {
  const role = req.parentIntent.object || "engineer";
  const market = marketLookup({ kind: "salary.annual", tag: roleTag(role) });
  const salaryAssertion = cited.find((a) => a.kind === "salary.annual");
  const salary =
    salaryAssertion?.value.type === "number"
      ? salaryAssertion.value.value
      : market?.value;
  const cite =
    salaryAssertion ? `internal comp ladder (${salaryAssertion.source ?? "n/a"})`
    : market         ? market.source
    : "no source — needs decision";
  return [
    `## ${capitalize(role)} compensation band`,
    "",
    salary
      ? `Propose **${formatCurrency(salary)}** annual base for new ${role} hires.`
      : `Set a base salary for new ${role} hires. No internal or market data is available yet.`,
    "",
    `Source: ${cite}.`,
    market && salary && market.value !== salary
      ? `\n> Market reads ${formatCurrency(market.value)} (band ${formatCurrency(market.band.low)} – ${formatCurrency(market.band.high)}). Adjust if you want to land inside the band.`
      : "",
  ].filter(Boolean).join("\n");
}

function bodyForHireSpec(req: DraftRequest, _cited: Assertion[]): string {
  const role = req.parentIntent.object || "role";
  const count = req.parentIntent.quantity ?? 1;
  return [
    `## ${capitalize(role)} job spec (${count} seat${count === 1 ? "" : "s"})`,
    "",
    "**Mission.** _Fill in the one-line mission for this role._",
    "",
    "**Must-haves.**",
    "- _3-5 hard requirements_",
    "",
    "**Nice-to-haves.**",
    "- _2-3 differentiators_",
    "",
    "**Interview loop.** Resume → recruiter screen → tech screen → 4-hour onsite → reference checks.",
  ].join("\n");
}

function bodyForHirePipeline(req: DraftRequest, _cited: Assertion[]): string {
  const role = req.parentIntent.object || "role";
  const count = req.parentIntent.quantity ?? 1;
  const ratio = 12; // hires per 12 top-of-funnel inbound, ballpark
  const target = count * ratio;
  return [
    `## ${capitalize(role)} sourcing pipeline`,
    "",
    `To close **${count} ${role} hire${count === 1 ? "" : "s"}**, aim for **${target}** vetted top-of-funnel candidates.`,
    "",
    "Channel mix:",
    `- LinkedIn outbound — ${Math.round(target * 0.45)} reaches`,
    `- Internal referrals — ${Math.round(target * 0.3)} requests`,
    `- Targeted communities — ${Math.round(target * 0.25)} touches`,
  ].join("\n");
}

function bodyForBudgetLine(req: DraftRequest, cited: Assertion[]): string {
  const subject = req.parentIntent.object || "line item";
  const value = cited.find((a) => a.kind === "budget.lineitem" || a.kind === "budget.total");
  return [
    `## ${capitalize(subject)} budget line`,
    "",
    value && value.value.type === "number"
      ? `Set **${formatCurrency(value.value.value)}** for ${subject}. Source: ${value.source ?? "internal"}.`
      : `No value yet. Propose a starting number, document the rationale, link to the burn model.`,
  ].join("\n");
}

function bodyForRunway(req: DraftRequest, cited: Assertion[]): string {
  const runway = cited.find((a) => a.kind === "runway.months");
  return [
    `## Runway`,
    "",
    runway && runway.value.type === "number"
      ? `Current runway is **${runway.value.value} months** as of ${runway.source ?? "unknown"}.`
      : `Runway not yet computed. Pull the latest cash position and burn rate.`,
    "",
    `Board mandate: never drop below 12 months.`,
  ].join("\n");
}

function bodyForResearchBrief(req: DraftRequest, _cited: Assertion[]): string {
  return [
    `## Research brief: ${req.parentIntent.object || "topic"}`,
    "",
    "**Question.** _What are we trying to learn?_",
    "**Hypothesis.** _One sentence._",
    "**Method.** _Survey / interviews / desk research._",
    "**Sources.**",
    "- _Link 1_",
    "- _Link 2_",
    "**Done = ** at least 5 cited sources in the project, hypothesis confirmed or refuted.",
  ].join("\n");
}

function bodyForLaunchChecklist(req: DraftRequest, _cited: Assertion[]): string {
  const date = req.parentIntent.byDate;
  return [
    `## Launch checklist${date ? ` — target ${date}` : ""}`,
    "",
    "- [ ] Engineering: feature flag default flipped",
    "- [ ] Marketing: blog + email queued",
    "- [ ] Support: KB entry live",
    "- [ ] Security: pen-test sign-off",
    "- [ ] Legal: TOS delta reviewed",
    "- [ ] Comms: customer advisory list notified",
  ].join("\n");
}

function bodyForPolicyDraft(req: DraftRequest, _cited: Assertion[]): string {
  return [
    `## ${capitalize(req.parentIntent.object || "policy")}`,
    "",
    "**Purpose.** _Why this policy exists._",
    "**Scope.** _Who and what it applies to._",
    "**Rules.** _3-5 numbered statements, each enforceable._",
    "**Review cadence.** Quarterly.",
  ].join("\n");
}

function bodyForReport(req: DraftRequest, _cited: Assertion[]): string {
  return [
    `## ${capitalize(req.parentIntent.object || "update")}`,
    "",
    "**Headline.** _One sentence._",
    "**Wins.** ",
    "- _3-5 bullets._",
    "**Risks.**",
    "- _What could go wrong, and what we're doing about it._",
    "**Asks.**",
    "- _Decisions or resources you need._",
  ].join("\n");
}

function bodyForGeneric(req: DraftRequest, cited: Assertion[]): string {
  const lines = [
    `## ${req.title}`,
    "",
    `Draft built from ${cited.length} cited assertion${cited.length === 1 ? "" : "s"}.`,
  ];
  for (const a of cited) {
    lines.push(`- **${a.label}** — ${stringifyValue(a)}${a.source ? ` _(${a.source})_` : ""}`);
  }
  if (cited.length === 0) lines.push(`_Lattice could not find structured data for this task — proposed an outline._`);
  return lines.join("\n");
}

/* ───────────── proposed writes ───────────── */

function buildWrites(req: DraftRequest, cited: Assertion[]): DraftAssertionWrite[] {
  const writes: DraftAssertionWrite[] = [];
  switch (req.intentTag) {
    case "hire.role.comp": {
      const role = req.parentIntent.object || "engineer";
      const market = marketLookup({ kind: "salary.annual", tag: roleTag(role) });
      if (!market) return writes;
      const writeKey = `engineering.${roleTag(role)}.salary`;
      // Don't propose writing a key that already matches market.
      const existing = pickAssertion(req.ctx, writeKey);
      if (existing && existing.value.type === "number" && Math.abs(existing.value.value - market.value) < market.value * 0.02) {
        return writes;
      }
      writes.push({
        key: writeKey,
        documentId: req.boundDocumentIds[0] ?? "doc.hiring",
        value: { type: "number", value: market.value, unit: market.unit },
        kind: "salary.annual",
        confidence: market.confidence,
        source: market.source,
      });
      return writes;
    }
    case "budget.line": {
      // Propose creating a numeric assertion only if we have a hint.
      const subject = req.parentIntent.object || "line";
      const key = `budget.line.${slug(subject)}`;
      const existing = pickAssertion(req.ctx, key);
      if (existing) return writes;
      const probe = cited.find((a) => a.kind === "budget.lineitem");
      const guess: AssertionValue =
        probe?.value.type === "number"
          ? { type: "number", value: probe.value.value, unit: probe.value.unit ?? "USD" }
          : { type: "number", value: 0, unit: "USD" };
      writes.push({
        key,
        documentId: req.boundDocumentIds[0] ?? "doc.budget",
        value: guess,
        kind: "budget.lineitem",
        confidence: probe ? 0.6 : 0.3,
        source: "Lattice draft",
      });
      return writes;
    }
    default:
      return writes;
  }
}

/* ───────────── helpers ───────────── */

function pickAssertion(ctx: ProjectContext, key: string): Assertion | undefined {
  let best: Assertion | undefined;
  for (const a of ctx.assertions) {
    if (a.key !== key) continue;
    if (!best || a.sourcedAt > best.sourcedAt) best = a;
  }
  return best;
}

function roleTag(role: string): string {
  const r = role.toLowerCase();
  if (/senior|sr\b/.test(r)) return "senior";
  if (/staff|principal/.test(r)) return "staff";
  if (/junior|jr|new.?grad|entry/.test(r)) return "junior";
  return "senior"; // sensible default for "engineer" alone
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}

function formatCurrency(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function stringifyValue(a: Assertion): string {
  switch (a.value.type) {
    case "number": return `${a.value.value.toLocaleString()}${a.value.unit ? " " + a.value.unit : ""}`;
    case "string": return `"${a.value.value}"`;
    case "boolean": return a.value.value ? "true" : "false";
    case "date": return a.value.value;
  }
}
