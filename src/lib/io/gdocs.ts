/**
 * Google Docs adapter — typed contract + plain-text fallback.
 *
 * Strategy: Google Docs API requires server-side OAuth + a service
 * account or per-user token. Our existing OAuth wiring
 * (`/api/integrations/google/*`) already gives us a token cache. The
 * adapter ships:
 *
 *   • serialise → a `GDocBatchUpdateRequest` payload the route can
 *     execute against `https://docs.googleapis.com/v1/documents/...`
 *     once Google Docs scope is added to the OAuth grant.
 *   • parse     → reads Google Docs API `documents.get` response shape.
 *
 * One-way today: parse coverage is limited because Google Docs' rich
 * formatting doesn't carry our manifest reliably. We embed the manifest
 * in a hidden trailing paragraph so parse can recover from our own exports.
 */

import type { ExportAdapter, ExportManifest } from "./types";

// Delimiter intentionally uses only word characters + `=` to survive
// HTML escaping in Google Docs' rendered output. Earlier drafts used
// `<<<...>>>` which got mangled to `&lt;...&gt;` in some flows.
const MANIFEST_DELIMITER = "===FORGE_MANIFEST_v1===";

/* ───────────── Docs API shapes (subset) ───────────── */

interface GDocBatchUpdateRequest {
  requests: Array<
    | { insertText: { location: { index: number }; text: string } }
    | { insertHeading: { location: { index: number }; namedStyleType: "HEADING_1" | "HEADING_2" | "HEADING_3" } }
  >;
}

/** Wire shape returned by our /api/projects/[pid]/export route. */
export interface GDocExportPayload {
  /** Final body content as a single string (newline-delimited paragraphs). */
  body: string;
  /** Title for the new document. */
  title: string;
  /** Folder id in Drive. Optional. */
  folderId?: string;
  /** Batch-update API payload for clients that want surgical insertion. */
  batchUpdate: GDocBatchUpdateRequest;
  /** Manifest sidecar for round-trip. */
  manifestSidecar: ExportManifest;
}

/* ───────────── serialise ───────────── */

export async function serialiseGDoc(manifest: ExportManifest): Promise<string> {
  // Build plain-text body first.
  const lines: string[] = [];
  lines.push(manifest.project.name);
  lines.push("");
  if (manifest.project.description) {
    lines.push(manifest.project.description);
    lines.push("");
  }
  if (manifest.documents.length > 0) {
    lines.push("DOCUMENTS");
    for (const doc of manifest.documents) {
      lines.push("");
      lines.push(doc.title);
      const blocks = manifest.blocks.filter((b) => b.documentId === doc.id);
      for (const b of blocks) {
        lines.push("");
        lines.push(b.body.trim());
      }
    }
    lines.push("");
  }
  if (manifest.assertions.length > 0) {
    lines.push("ASSERTIONS");
    for (const a of manifest.assertions) {
      const v = a.value.type === "number"
        ? `${a.value.value}${a.value.unit ? " " + a.value.unit : ""}`
        : String(a.value.value);
      lines.push(`• ${a.label} (${a.key}) — ${v}`);
    }
    lines.push("");
  }
  if (manifest.habits.length > 0) {
    lines.push("HABITS");
    for (const h of manifest.habits) lines.push(`• ${h.title} · ${h.rrule}`);
    lines.push("");
  }
  if (manifest.goals.length > 0) {
    lines.push("GOALS");
    for (const g of manifest.goals) lines.push(`• ${g.title}`);
    lines.push("");
  }

  // Manifest sidecar — base64 to survive Google Docs' formatting.
  const sidecar = Buffer.from(JSON.stringify(manifest)).toString("base64");
  lines.push("");
  lines.push(MANIFEST_DELIMITER);
  lines.push(sidecar);
  lines.push(MANIFEST_DELIMITER);

  const body = lines.join("\n");

  // Build the equivalent batchUpdate request.
  const batchUpdate: GDocBatchUpdateRequest = {
    requests: [
      { insertText: { location: { index: 1 }, text: body } },
    ],
  };

  const payload: GDocExportPayload = {
    title: manifest.project.name,
    body,
    batchUpdate,
    manifestSidecar: manifest,
  };
  return JSON.stringify(payload, null, 2);
}

export async function parseGDoc(raw: string): Promise<ExportManifest> {
  // Path 1 — JSON wire payload from our own export.
  try {
    const parsed = JSON.parse(raw) as Partial<GDocExportPayload>;
    if (parsed.manifestSidecar) return parsed.manifestSidecar;
    if (parsed.body) {
      const m = parsed.body.match(new RegExp(`${MANIFEST_DELIMITER}\\s+([A-Za-z0-9+/=]+)\\s+${MANIFEST_DELIMITER}`));
      if (m) return JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
    }
  } catch {/* fall through */}

  // Path 2 — raw text body export (user pasted Google Doc contents).
  const m = raw.match(new RegExp(`${MANIFEST_DELIMITER}\\s+([A-Za-z0-9+/=]+)\\s+${MANIFEST_DELIMITER}`));
  if (m) {
    try {
      return JSON.parse(Buffer.from(m[1], "base64").toString("utf8"));
    } catch {/* fall through */}
  }

  // Path 3 — best-effort empty manifest.
  return {
    version: "v1",
    origin: { app: "forge", projectId: "imported-gdoc", exportedAt: Date.now() },
    project: { id: "imported-gdoc", name: "Imported from Google Docs" },
    include: { syncGraph: false, pulseBlocks: false, documents: true, lattice: false, calendar: false },
    assertions: [], documents: [], blocks: [], constraints: [], habits: [], goals: [],
    meta: { sourceFormat: "gdoc", note: "Manifest sidecar not found — only prose import is possible." },
  };
}

/* ───────────── adapter ───────────── */

export const gdocAdapter: ExportAdapter = {
  format: "gdoc",
  contentType: "application/json",
  extension: "gdoc.json",
  serialise: serialiseGDoc,
  parse: parseGDoc,
};
