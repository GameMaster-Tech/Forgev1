/**
 * Notion adapter — typed contract.
 *
 * v1 strategy: serialise the manifest into a **Notion-API-ready
 * payload** (an array of block objects). The route returns this JSON;
 * a caller pipes it to Notion via the `@notionhq/client` SDK or curls
 * it directly to the Notion API.
 *
 * We don't take an `@notionhq/client` dependency in core because:
 *  • the SDK is server-only,
 *  • the user may not have a Notion integration token,
 *  • our export is shape-stable whether or not we ship the SDK.
 *
 * Parse is symmetric: we read the same payload shape back into a
 * manifest.
 */

import type { ExportAdapter, ExportManifest } from "./types";

/* ───────────── Notion API block shapes (subset we need) ───────────── */

type RichTextRun =
  | { type: "text"; text: { content: string; link?: { url: string } | null }; annotations?: NotionAnnotations }
  | { type: "mention"; mention: { type: "page"; page: { id: string } } | { type: "database"; database: { id: string } } | { type: "user"; user: { id: string } }; plain_text?: string };

interface NotionAnnotations {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  color?: string;
}

type Block =
  | { type: "heading_1"; heading_1: { rich_text: RichTextRun[] } }
  | { type: "heading_2"; heading_2: { rich_text: RichTextRun[] } }
  | { type: "heading_3"; heading_3: { rich_text: RichTextRun[] } }
  | { type: "paragraph"; paragraph: { rich_text: RichTextRun[] } }
  | { type: "bulleted_list_item"; bulleted_list_item: { rich_text: RichTextRun[] } }
  | { type: "divider"; divider: Record<string, never> }
  | { type: "code"; code: { rich_text: RichTextRun[]; language: string } }
  | { type: "callout"; callout: { rich_text: RichTextRun[]; icon: { type: "emoji"; emoji: string } } };

export interface NotionExportPayload {
  /** Title of the new Notion page. */
  title: string;
  /** Properties for the parent database (if databaseId provided). */
  properties?: Record<string, unknown>;
  /** Block array to append. */
  children: Block[];
  /** Manifest persisted as a code block at the bottom so parse round-trips. */
  manifestSidecar: ExportManifest;
}

/* ───────────── serialise ───────────── */

function text(content: string, annotations?: NotionAnnotations): RichTextRun {
  return { type: "text", text: { content }, annotations };
}

function h2(content: string): Block {
  return { type: "heading_2", heading_2: { rich_text: [text(content)] } };
}
function h3(content: string): Block {
  return { type: "heading_3", heading_3: { rich_text: [text(content)] } };
}
function para(content: string): Block {
  return { type: "paragraph", paragraph: { rich_text: [text(content)] } };
}
function bullet(content: string): Block {
  return { type: "bulleted_list_item", bulleted_list_item: { rich_text: [text(content)] } };
}

export async function serialiseNotion(manifest: ExportManifest): Promise<string> {
  const children: Block[] = [];

  children.push({
    type: "callout",
    callout: {
      rich_text: [text("Exported from Forge.")],
      icon: { type: "emoji", emoji: "📦" },
    },
  });
  if (manifest.project.description) children.push(para(manifest.project.description));
  children.push({ type: "divider", divider: {} });

  if (manifest.documents.length > 0) {
    children.push(h2("Documents"));
    for (const doc of manifest.documents) {
      children.push(h3(doc.title));
      const blocks = manifest.blocks.filter((b) => b.documentId === doc.id);
      for (const b of blocks) children.push(para(b.body.trim()));
    }
  }

  if (manifest.assertions.length > 0) {
    children.push(h2("Assertions"));
    for (const a of manifest.assertions) {
      const v = a.value.type === "number"
        ? `${a.value.value}${a.value.unit ? " " + a.value.unit : ""}`
        : a.value.type === "string"
        ? a.value.value
        : a.value.type === "date"
        ? a.value.value
        : String(a.value.value);
      children.push(bullet(`${a.label} (\`${a.key}\`) — ${v} · ${a.kind} · ${(a.confidence * 100).toFixed(0)}% trust`));
    }
  }

  if (manifest.constraints.length > 0) {
    children.push(h2("Constraints"));
    for (const c of manifest.constraints) {
      children.push(bullet(`${c.rationale} · ${c.kind} · severity=${c.severity}`));
    }
  }

  if (manifest.habits.length > 0) {
    children.push(h2("Habits"));
    for (const h of manifest.habits) {
      children.push(bullet(`${h.title} · ${h.rrule} · ${h.durationMinutes} min · streak ${h.streak}d`));
    }
  }

  if (manifest.goals.length > 0) {
    children.push(h2("Goals"));
    for (const g of manifest.goals) {
      const target = g.targetDate ? `target ${g.targetDate.slice(0, 10)}` : "no deadline";
      children.push(bullet(`${g.title} · ${target} · ${g.status}`));
    }
  }

  // Manifest sidecar — encoded as a code block so re-import is lossless.
  children.push({ type: "divider", divider: {} });
  children.push(h3("Forge manifest"));
  children.push({
    type: "code",
    code: {
      rich_text: [text(JSON.stringify(manifest, null, 2))],
      language: "json",
    },
  });

  const payload: NotionExportPayload = {
    title: manifest.project.name,
    children,
    manifestSidecar: manifest,
  };
  return JSON.stringify(payload, null, 2);
}

export async function parseNotion(raw: string): Promise<ExportManifest> {
  // Two paths:
  //   1. We exported it — the JSON has manifestSidecar; reuse directly.
  //   2. Generic Notion export — best-effort reconstruction.
  try {
    const parsed = JSON.parse(raw) as NotionExportPayload | { manifestSidecar?: ExportManifest };
    if ("manifestSidecar" in parsed && parsed.manifestSidecar) {
      return parsed.manifestSidecar;
    }
  } catch {/* fall through */}
  // Best-effort: produce a minimal manifest so the user isn't stuck.
  return {
    version: "v1",
    origin: { app: "forge", projectId: "imported-notion", exportedAt: Date.now() },
    project: { id: "imported-notion", name: "Imported from Notion" },
    include: { syncGraph: false, pulseBlocks: false, documents: true, lattice: false, calendar: false },
    assertions: [], documents: [], blocks: [], constraints: [], habits: [], goals: [],
    meta: { sourceFormat: "notion", note: "Raw paste — manifest sidecar absent; only structural import available." },
  };
}

/* ───────────── adapter ───────────── */

export const notionAdapter: ExportAdapter = {
  format: "notion",
  contentType: "application/json",
  extension: "notion.json",
  serialise: serialiseNotion,
  parse: parseNotion,
};
