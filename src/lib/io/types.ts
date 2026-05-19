/**
 * Export / Import — types.
 *
 * A `Manifest` is the structured payload that round-trips through
 * Markdown / Notion / Google Docs. It is format-agnostic: each
 * adapter (markdown.ts, notion.ts, gdocs.ts) knows how to serialise
 * and parse a Manifest.
 *
 * Round-trip invariants:
 *   • Citations (`[[claim:<key>]]`) preserve through all formats.
 *   • Assertions, documents, habits, and goals preserve structurally
 *     in Markdown + Notion. Google Docs preserves prose only; the
 *     manifest survives as a hidden footer table.
 */

import type { Assertion, ConstraintEdge, DocumentNode } from "../sync/types";
import type { Goal, Habit } from "../scheduler";
import type { ContentBlock } from "../pulse/types";

export type ExportFormat = "markdown" | "notion" | "gdoc" | "json";
export type ImportSource = "file" | "paste" | "url";

/* ───────────── manifest (canonical shape) ───────────── */

export interface ExportManifest {
  version: "v1";
  /** Repo + project this manifest came from. */
  origin: { app: "forge"; projectId: string; exportedAt: number };
  project: {
    id: string;
    name: string;
    description?: string;
  };
  /** Which features were included in the export. */
  include: ExportInclude;
  /** Workspace data. Empty arrays for excluded features. */
  assertions: Assertion[];
  documents: DocumentNode[];
  blocks: ContentBlock[];
  constraints: ConstraintEdge[];
  habits: Habit[];
  goals: Goal[];
  /** Free-form metadata adapters may stash here. */
  meta?: Record<string, unknown>;
}

export interface ExportInclude {
  syncGraph: boolean;          // assertions + constraints
  pulseBlocks: boolean;        // ContentBlocks
  documents: boolean;          // prose documents
  lattice: boolean;            // task trees (future — empty for v1)
  calendar: boolean;           // events / habits / goals
}

export const DEFAULT_INCLUDE: ExportInclude = {
  syncGraph:    true,
  pulseBlocks:  true,
  documents:    true,
  lattice:      false,         // requires a project-aware fetcher
  calendar:     true,
};

/* ───────────── format options ───────────── */

export interface MarkdownExportOptions {
  /** Render assertions as a YAML front-matter table. */
  frontMatter: boolean;
  /** Render constraints as an appendix section. */
  appendix: boolean;
  /** Preserve `[[claim:<key>]]` literally. When false, render as the
   *  current value with a footnote citation. */
  preserveClaimMarkers: boolean;
}

export const DEFAULT_MARKDOWN_OPTIONS: MarkdownExportOptions = {
  frontMatter: true,
  appendix: true,
  preserveClaimMarkers: true,
};

export interface NotionExportOptions {
  /** Notion database id where new pages will land (provided by user). */
  databaseId?: string;
}

export interface GoogleDocsExportOptions {
  /** Destination folder id in Google Drive. Optional — defaults to root. */
  folderId?: string;
}

/* ───────────── import contract ───────────── */

export interface ImportPayload {
  format: ExportFormat;
  source: ImportSource;
  /** Raw text for paste/file. URL fetcher handled by the route. */
  raw: string;
  /** File metadata (size, name) if uploaded. */
  fileMeta?: { name: string; sizeBytes: number };
}

export interface ImportPreview {
  /** Inferred manifest shape — what we'd commit. */
  manifest: ExportManifest;
  /** Per-collection counts surfaced in the UI before the user commits. */
  counts: {
    assertions: number;
    documents: number;
    constraints: number;
    habits: number;
    goals: number;
    blocks: number;
  };
  /** Validation issues that don't block the import. */
  warnings: string[];
  /** Hard issues that DO block the import. */
  errors: string[];
}

/* ───────────── adapter contract ───────────── */

export interface ExportAdapter<O = unknown> {
  format: ExportFormat;
  /** Produce a string (or blob payload) the route returns. */
  serialise(manifest: ExportManifest, options?: O): Promise<string>;
  /** Parse the source string back into a manifest. May be unsupported
   *  for one-way formats (gdoc). */
  parse?(raw: string): Promise<ExportManifest>;
  /** Mime type for the route's response. */
  contentType: string;
  /** File extension for downloads. */
  extension: string;
}
