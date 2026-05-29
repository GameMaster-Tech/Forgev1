"use client";

/**
 * Reactive scan — find Living Sections (and which have drifted) across a
 * document's saved HTML. Powers Calm Review: a workspace-wide, calm read of
 * what's gone stale, without per-section recomputation (we trust the drift
 * status the editor persists onto each node).
 *
 * Client-only (uses DOMParser). A Living Section node serialises its payload
 * to a `data-living-section` attribute (see the node extension), so we parse
 * that JSON straight out of the stored HTML.
 */

export interface ScannedSection {
  id: string;
  rule: string;
  /** "empty" | "computing" | "stable" | "drifting" | "frozen" | "error" */
  status: string;
}

/** Cheap pre-check so callers can skip docs with no Living Sections. */
export function hasLivingSections(html: string): boolean {
  return typeof html === "string" && html.includes("data-living-section");
}

/** Parse every Living Section out of a document's saved HTML. */
export function extractLivingSections(html: string): ScannedSection[] {
  if (typeof window === "undefined" || !hasLivingSections(html)) return [];
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return [];
  }
  const out: ScannedSection[] = [];
  doc.querySelectorAll("[data-living-section]").forEach((el) => {
    const raw = el.getAttribute("data-living-section");
    if (!raw) return;
    try {
      const d = JSON.parse(raw) as Partial<ScannedSection>;
      if (typeof d.id === "string") {
        out.push({
          id: d.id,
          rule: typeof d.rule === "string" ? d.rule : "",
          status: typeof d.status === "string" ? d.status : "empty",
        });
      }
    } catch {
      /* skip malformed node */
    }
  });
  return out;
}

/** A section counts as needing attention when it has drifted from its source. */
export function isDrifted(s: ScannedSection): boolean {
  return s.status === "drifting";
}
