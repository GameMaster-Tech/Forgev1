/**
 * Refactor — given a set of invalidated assertions, regenerate the
 * affected document content blocks. For value-swap cases we do a
 * literal string substitution; for harder cases we fall back to a
 * scoped "needs human" annotation that the editor can render inline.
 */

import type { Assertion, AssertionId } from "../sync/types";
import type { ContentBlock, RealityDiff, RefactorProposal } from "./types";

/**
 * Build proposals for every block that references at least one
 * invalidated assertion. Pure.
 */
export function refactorBlocks(
  blocks: ContentBlock[],
  diffs: RealityDiff[],
  assertions: Map<AssertionId, Assertion>,
): RefactorProposal[] {
  const invalid = new Map<AssertionId, RealityDiff>();
  for (const d of diffs) {
    if (d.status === "invalidated" && d.realityValue) invalid.set(d.assertionId, d);
  }
  if (invalid.size === 0) return [];

  const out: RefactorProposal[] = [];
  for (const block of blocks) {
    const triggers = block.referencedAssertionIds.filter((id) => invalid.has(id));
    if (triggers.length === 0) continue;

    let body = block.body;
    let allValueSwaps = true;
    for (const aid of triggers) {
      const d = invalid.get(aid)!;
      const a = assertions.get(aid);
      if (!a) continue;
      const swapped = trySwap(body, a, d);
      if (swapped === body) {
        // Couldn't pinpoint — append an annotation.
        body = appendAnnotation(body, a, d);
        allValueSwaps = false;
      } else {
        body = swapped;
      }
    }

    out.push({
      blockId: block.id,
      documentId: block.documentId,
      before: block.body,
      after: body,
      triggeredBy: triggers,
      kind: allValueSwaps ? "value-swap" : "text-rewrite",
    });
  }
  return out;
}

function trySwap(body: string, a: Assertion, d: RealityDiff): string {
  if (a.value.type !== "number" || !d.realityValue || d.realityValue.type !== "number") return body;
  const oldLiteral = formatNumber(a.value.value, a.value.unit);
  const newLiteral = formatNumber(d.realityValue.value, d.realityValue.unit ?? a.value.unit);
  // Replace ALL occurrences but only when surrounded by word boundaries
  // / currency symbols, so we don't mangle unrelated numbers. Use a
  // fresh regex per call so the stateful /g lastIndex never bites us.
  const escaped = oldLiteral.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(\\b|\\$)${escaped}(\\b|/)`, "g");
  const next = body.replace(re, (_, l, r) => `${l}${newLiteral}${r}`);
  return next === body ? body : next;
}

function appendAnnotation(body: string, a: Assertion, d: RealityDiff): string {
  const marker = `\n\n> ⚠ **Pulse**: \`${a.label}\` is invalidated (drift ${(d.driftRatio * 100).toFixed(1)}%). Live reading: ${describe(d.realityValue)} (${d.realitySource ?? "oracle"}). Source: ${a.source ?? "n/a"}.`;
  // Don't double-annotate.
  if (body.includes(`Pulse**: \`${a.label}\``)) return body;
  return body + marker;
}

function describe(v: Assertion["value"] | null): string {
  if (!v) return "n/a";
  switch (v.type) {
    case "number": return `${v.value.toLocaleString()}${v.unit ? " " + v.unit : ""}`;
    case "string": return `"${v.value}"`;
    case "date": return v.value;
    case "boolean": return v.value ? "true" : "false";
  }
}

function formatNumber(n: number, unit?: string): string {
  const formatted = n.toLocaleString("en-US");
  if (!unit) return formatted;
  if (/^USD$/.test(unit)) return `$${formatted}`;
  if (/^percent$/i.test(unit)) return `${n}%`;
  return `${formatted} ${unit}`;
}
