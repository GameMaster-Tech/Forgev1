/**
 * Public io API — manifest builder + format-keyed adapter registry +
 * preview/validation helpers.
 */

import type { Assertion, ConstraintEdge, DocumentNode } from "../sync/types";
import type { ContentBlock } from "../pulse/types";
import type { Goal, Habit } from "../scheduler";
import { gdocAdapter } from "./gdocs";
import { jsonAdapter } from "./json";
import { markdownAdapter } from "./markdown";
import { notionAdapter } from "./notion";
import {
  DEFAULT_INCLUDE,
  type ExportAdapter,
  type ExportFormat,
  type ExportInclude,
  type ExportManifest,
  type ImportPreview,
} from "./types";

export type {
  ExportAdapter,
  ExportFormat,
  ExportInclude,
  ExportManifest,
  MarkdownExportOptions,
  NotionExportOptions,
  GoogleDocsExportOptions,
  ImportPayload,
  ImportPreview,
  ImportSource,
} from "./types";
export {
  DEFAULT_INCLUDE,
  DEFAULT_MARKDOWN_OPTIONS,
} from "./types";

export { findCitations, rewriteCitations, stripCitations, inlineCitations } from "./citations";
export { markdownAdapter, parseMarkdown, serialiseMarkdown } from "./markdown";
export { notionAdapter, parseNotion, serialiseNotion } from "./notion";
export { gdocAdapter, parseGDoc, serialiseGDoc } from "./gdocs";
export { jsonAdapter, parseJson, serialiseJson } from "./json";

const ADAPTERS: Record<ExportFormat, ExportAdapter> = {
  markdown: markdownAdapter,
  notion:   notionAdapter,
  gdoc:     gdocAdapter,
  json:     jsonAdapter,
};

export function getAdapter(format: ExportFormat): ExportAdapter {
  return ADAPTERS[format];
}

/* ───────────── manifest builder ───────────── */

export interface BuildManifestInput {
  projectId: string;
  projectName: string;
  description?: string;
  include?: Partial<ExportInclude>;
  assertions?: Assertion[];
  documents?: DocumentNode[];
  blocks?: ContentBlock[];
  constraints?: ConstraintEdge[];
  habits?: Habit[];
  goals?: Goal[];
  now?: number;
}

/**
 * Build a manifest from raw workspace data + an include map. Pure.
 * Filters out collections excluded by `include`, so downstream
 * serialisers don't need to know about feature flags.
 */
export function buildManifest(input: BuildManifestInput): ExportManifest {
  const include = { ...DEFAULT_INCLUDE, ...(input.include ?? {}) };
  return {
    version: "v1",
    origin: {
      app: "forge",
      projectId: input.projectId,
      exportedAt: input.now ?? Date.now(),
    },
    project: {
      id: input.projectId,
      name: input.projectName,
      description: input.description,
    },
    include,
    assertions:  include.syncGraph    ? input.assertions  ?? [] : [],
    documents:   include.documents    ? input.documents   ?? [] : [],
    blocks:      include.pulseBlocks  ? input.blocks      ?? [] : [],
    constraints: include.syncGraph    ? input.constraints ?? [] : [],
    habits:      include.calendar     ? input.habits      ?? [] : [],
    goals:       include.calendar     ? input.goals       ?? [] : [],
  };
}

/* ───────────── import validation ───────────── */

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB soft cap

export async function previewImport(raw: string, format: ExportFormat): Promise<ImportPreview> {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!raw.trim()) {
    return {
      manifest: emptyManifest(),
      counts: { assertions: 0, documents: 0, constraints: 0, habits: 0, goals: 0, blocks: 0 },
      warnings: [],
      errors: ["Empty input."],
    };
  }
  if (raw.length > MAX_BYTES) {
    warnings.push(`Input is large (${(raw.length / 1024 / 1024).toFixed(1)} MB). Parsing may be slow.`);
  }

  const adapter = getAdapter(format);
  if (!adapter.parse) {
    errors.push(`Format "${format}" doesn't support import yet.`);
    return {
      manifest: emptyManifest(),
      counts: { assertions: 0, documents: 0, constraints: 0, habits: 0, goals: 0, blocks: 0 },
      warnings,
      errors,
    };
  }

  let manifest: ExportManifest;
  try {
    manifest = await adapter.parse(raw);
  } catch (err) {
    return {
      manifest: emptyManifest(),
      counts: { assertions: 0, documents: 0, constraints: 0, habits: 0, goals: 0, blocks: 0 },
      warnings,
      errors: [`Parse failed: ${(err as Error).message}`],
    };
  }

  // Sanity checks.
  if (manifest.version !== "v1") {
    warnings.push(`Manifest version is "${manifest.version}", expected "v1". Falling back to v1 semantics.`);
  }
  if (manifest.assertions.length === 0 && manifest.documents.length === 0) {
    warnings.push("Manifest contains no assertions and no documents — nothing meaningful to import?");
  }

  return {
    manifest,
    counts: {
      assertions:  manifest.assertions.length,
      documents:   manifest.documents.length,
      constraints: manifest.constraints.length,
      habits:      manifest.habits.length,
      goals:       manifest.goals.length,
      blocks:      manifest.blocks.length,
    },
    warnings,
    errors,
  };
}

function emptyManifest(): ExportManifest {
  return {
    version: "v1",
    origin: { app: "forge", projectId: "empty", exportedAt: Date.now() },
    project: { id: "empty", name: "Empty" },
    include: DEFAULT_INCLUDE,
    assertions: [], documents: [], blocks: [], constraints: [], habits: [], goals: [],
  };
}
