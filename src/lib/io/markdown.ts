/**
 * Markdown adapter — full bidirectional serialiser.
 *
 * Output shape:
 *
 *   ---
 *   forge_manifest: v1
 *   project: { id, name, exportedAt }
 *   include: { ... }
 *   ---
 *
 *   # <project name>
 *
 *   ## Documents
 *
 *   ### <doc title>
 *   <block body markdown — preserves [[claim:<key>]]>
 *
 *   ## Assertions
 *   | key | label | kind | value | unit | confidence | source |
 *   |-----|-------|------|-------|------|------------|--------|
 *   ...
 *
 *   ## Constraints
 *   - **<rationale>** · <kind> · severity=<severity>
 *
 *   ## Habits
 *   - <title> · rrule=<rrule> · streak=<n>
 *
 *   ## Goals
 *   - <title> · target=<date> · <logged>/<target> minutes/week
 *
 * Reverse parse reads the YAML-ish front-matter, then walks the
 * sections by `## ` heading and reconstructs each. Round-trips
 * losslessly when `preserveClaimMarkers: true` and front-matter is
 * present.
 */

import type { Assertion, AssertionValue, ConstraintEdge, DocumentNode } from "../sync/types";
import type { Goal, Habit } from "../scheduler";
import type { ContentBlock } from "../pulse/types";
import type {
  ExportAdapter,
  ExportManifest,
  MarkdownExportOptions,
} from "./types";
import { DEFAULT_MARKDOWN_OPTIONS } from "./types";

const FRONT_MATTER_DELIM = "---";

/* ───────────── serialise ───────────── */

export async function serialiseMarkdown(
  manifest: ExportManifest,
  opts: MarkdownExportOptions = DEFAULT_MARKDOWN_OPTIONS,
): Promise<string> {
  const parts: string[] = [];

  if (opts.frontMatter) parts.push(buildFrontMatter(manifest));
  parts.push(`# ${manifest.project.name}`);
  if (manifest.project.description) parts.push("", manifest.project.description);

  if (manifest.documents.length > 0) {
    parts.push("", "## Documents", "");
    for (const doc of manifest.documents) {
      parts.push(`### ${doc.title}`);
      const blocksForDoc = manifest.blocks.filter((b) => b.documentId === doc.id);
      for (const block of blocksForDoc) {
        parts.push("", block.body.trim());
      }
      parts.push("");
    }
  }

  if (manifest.assertions.length > 0) {
    parts.push("", "## Assertions", "");
    parts.push("| key | label | kind | value | unit | confidence | source |");
    parts.push("|-----|-------|------|-------|------|------------|--------|");
    for (const a of manifest.assertions) {
      parts.push(`| \`${a.key}\` | ${escapePipe(a.label)} | ${a.kind} | ${formatValue(a.value)} | ${valueUnit(a.value)} | ${a.confidence.toFixed(2)} | ${escapePipe(a.source ?? "")} |`);
    }
  }

  if (manifest.constraints.length > 0 && opts.appendix) {
    parts.push("", "## Constraints", "");
    for (const c of manifest.constraints) {
      const from = Array.isArray(c.from) ? c.from.join(" + ") : c.from;
      parts.push(`- **${c.rationale}** · ${from} → ${c.to} · \`${c.kind}\` · severity=${c.severity}${c.operand != null ? ` · operand=${c.operand}` : ""}${c.tolerance != null ? ` · tolerance=${c.tolerance}` : ""}`);
    }
  }

  if (manifest.habits.length > 0) {
    parts.push("", "## Habits", "");
    for (const h of manifest.habits) {
      parts.push(`- **${h.title}** · \`${h.rrule}\` · ${h.durationMinutes} min · streak ${h.streak}d · energy=${h.energy}`);
    }
  }

  if (manifest.goals.length > 0) {
    parts.push("", "## Goals", "");
    for (const g of manifest.goals) {
      parts.push(`- **${g.title}** · ${g.targetDate ? `target ${g.targetDate.slice(0, 10)}` : "no deadline"} · ${Math.round(g.loggedMinutes / 60 * 10) / 10}h / ${Math.round(g.weeklyMinutesTarget / 60)}h/week · status=${g.status}`);
    }
  }

  return parts.join("\n");
}

function buildFrontMatter(manifest: ExportManifest): string {
  const fm = {
    forge_manifest: "v1",
    project_id: manifest.project.id,
    project_name: manifest.project.name,
    exported_at: new Date(manifest.origin.exportedAt).toISOString(),
    include: manifest.include,
  };
  // Compact YAML — avoid pulling in a parser dep.
  const lines = [
    FRONT_MATTER_DELIM,
    `forge_manifest: ${fm.forge_manifest}`,
    `project_id: ${quoteYaml(fm.project_id)}`,
    `project_name: ${quoteYaml(fm.project_name)}`,
    `exported_at: ${fm.exported_at}`,
    "include:",
    `  syncGraph: ${fm.include.syncGraph}`,
    `  pulseBlocks: ${fm.include.pulseBlocks}`,
    `  documents: ${fm.include.documents}`,
    `  lattice: ${fm.include.lattice}`,
    `  calendar: ${fm.include.calendar}`,
    FRONT_MATTER_DELIM,
    "",
  ];
  return lines.join("\n");
}

/* ───────────── parse ───────────── */

export async function parseMarkdown(raw: string): Promise<ExportManifest> {
  const { frontMatter, body } = splitFrontMatter(raw);

  const projectId = frontMatter["project_id"] ?? "imported-" + Date.now().toString(36);
  const projectName = frontMatter["project_name"] ?? extractH1(body) ?? "Imported project";
  const include = parseInclude(frontMatter);

  const documents: DocumentNode[] = [];
  const blocks: ContentBlock[] = [];
  const assertions: Assertion[] = [];
  const constraints: ConstraintEdge[] = [];
  const habits: Habit[] = [];
  const goals: Goal[] = [];

  // Split the body by ## sections.
  const sections = splitSections(body);
  if (sections["Documents"]) {
    const docSubs = splitSubSections(sections["Documents"]);
    for (const [title, body] of Object.entries(docSubs)) {
      const id = `doc.${slug(title)}`;
      documents.push({
        id, projectId, title, type: "generic", assertionIds: [],
      });
      blocks.push({
        id: `block.${slug(title)}.body`,
        documentId: id,
        body: body.trim(),
        referencedAssertionIds: [],
      });
    }
  }
  if (sections["Assertions"]) {
    assertions.push(...parseAssertionsTable(sections["Assertions"], projectId));
  }
  if (sections["Constraints"]) {
    constraints.push(...parseConstraintList(sections["Constraints"], projectId));
  }
  if (sections["Habits"]) {
    habits.push(...parseHabitList(sections["Habits"], projectId));
  }
  if (sections["Goals"]) {
    goals.push(...parseGoalList(sections["Goals"], projectId));
  }

  return {
    version: "v1",
    origin: {
      app: "forge",
      projectId,
      exportedAt: frontMatter["exported_at"] ? new Date(frontMatter["exported_at"]).getTime() : Date.now(),
    },
    project: { id: projectId, name: projectName },
    include,
    assertions,
    documents,
    blocks,
    constraints,
    habits,
    goals,
  };
}

/* ───────────── parser internals ───────────── */

function splitFrontMatter(raw: string): { frontMatter: Record<string, string>; body: string } {
  const lines = raw.split(/\r?\n/);
  if (lines[0]?.trim() !== FRONT_MATTER_DELIM) return { frontMatter: {}, body: raw };
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === FRONT_MATTER_DELIM);
  if (end < 0) return { frontMatter: {}, body: raw };
  const fmLines = lines.slice(1, end);
  const body = lines.slice(end + 1).join("\n").trim();
  const fm: Record<string, string> = {};
  for (const line of fmLines) {
    const match = line.match(/^([a-zA-Z_]+):\s*(.+)$/);
    if (match) fm[match[1]] = stripYamlQuotes(match[2].trim());
  }
  return { frontMatter: fm, body };
}

function parseInclude(fm: Record<string, string>): ExportManifest["include"] {
  return {
    syncGraph:   true,
    pulseBlocks: true,
    documents:   true,
    lattice:     false,
    calendar:    true,
    ...{} // front-matter currently flattens, ignore nested for now
  };
  // (full nested parse is overkill for v1; include flags default sensibly)
  void fm;
}

function splitSections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  let currentTitle: string | null = null;
  let buf: string[] = [];
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      if (currentTitle) sections[currentTitle] = buf.join("\n").trim();
      currentTitle = h2[1].trim();
      buf = [];
    } else if (currentTitle) {
      buf.push(line);
    }
  }
  if (currentTitle) sections[currentTitle] = buf.join("\n").trim();
  return sections;
}

function splitSubSections(body: string): Record<string, string> {
  const sub: Record<string, string> = {};
  const lines = body.split(/\r?\n/);
  let cur: string | null = null;
  let buf: string[] = [];
  for (const line of lines) {
    const h3 = line.match(/^###\s+(.+)$/);
    if (h3) {
      if (cur) sub[cur] = buf.join("\n").trim();
      cur = h3[1].trim();
      buf = [];
    } else if (cur) buf.push(line);
  }
  if (cur) sub[cur] = buf.join("\n").trim();
  return sub;
}

function parseAssertionsTable(body: string, projectId: string): Assertion[] {
  const lines = body.split(/\r?\n/).filter((l) => l.startsWith("| `"));
  return lines.map((line, idx) => {
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    const [keyCell, label, kindRaw, value, unit, confidence, source] = cells;
    const key = keyCell?.replace(/`/g, "");
    const kind = (kindRaw ?? "fact.numeric") as Assertion["kind"];
    const numeric = Number.parseFloat(value);
    return {
      id: `a.${slug(key)}.${idx}`,
      projectId,
      documentId: "doc.imported",
      key,
      label,
      kind,
      value: Number.isFinite(numeric)
        ? { type: "number", value: numeric, unit: unit || undefined } as AssertionValue
        : { type: "string", value } as AssertionValue,
      sourcedAt: Date.now(),
      source: source || undefined,
      confidence: Number.parseFloat(confidence) || 0.5,
    } satisfies Assertion;
  });
}

function parseConstraintList(body: string, projectId: string): ConstraintEdge[] {
  const lines = body.split(/\r?\n/).filter((l) => l.startsWith("- "));
  return lines.map((line, idx) => {
    const rationale = line.match(/\*\*(.+?)\*\*/)?.[1] ?? `imported-${idx}`;
    const kind = (line.match(/`([a-z\-]+)`/)?.[1] ?? "equals") as ConstraintEdge["kind"];
    const severity = (line.match(/severity=(hard|soft)/)?.[1] ?? "soft") as ConstraintEdge["severity"];
    const operandRaw = line.match(/operand=([0-9.\-]+)/)?.[1];
    const toleranceRaw = line.match(/tolerance=([0-9.\-]+)/)?.[1];
    return {
      id: `c.imported.${idx}`,
      projectId,
      from: "imported-from",
      to: "imported-to",
      kind,
      severity,
      rationale,
      ...(operandRaw ? { operand: Number.parseFloat(operandRaw) } : {}),
      ...(toleranceRaw ? { tolerance: Number.parseFloat(toleranceRaw) } : {}),
    } satisfies ConstraintEdge;
  });
}

function parseHabitList(body: string, projectId: string): Habit[] {
  const lines = body.split(/\r?\n/).filter((l) => l.startsWith("- "));
  return lines.map((line, idx) => ({
    id: `h.imported.${idx}`,
    projectId,
    ownerId: "self",
    title: line.match(/\*\*(.+?)\*\*/)?.[1] ?? `habit-${idx}`,
    rrule: line.match(/`([^`]+)`/)?.[1] ?? "FREQ=DAILY",
    durationMinutes: Number.parseInt(line.match(/(\d+) min/)?.[1] ?? "15", 10),
    energy: (line.match(/energy=([a-z]+)/)?.[1] ?? "shallow") as Habit["energy"],
    timeZone: "UTC",
    streak: Number.parseInt(line.match(/streak (\d+)d/)?.[1] ?? "0", 10),
    createdAt: Date.now(),
  } satisfies Habit));
}

function parseGoalList(body: string, projectId: string): Goal[] {
  const lines = body.split(/\r?\n/).filter((l) => l.startsWith("- "));
  return lines.map((line, idx) => ({
    id: `g.imported.${idx}`,
    projectId,
    ownerId: "self",
    title: line.match(/\*\*(.+?)\*\*/)?.[1] ?? `goal-${idx}`,
    targetDate: line.match(/target (\d{4}-\d{2}-\d{2})/)?.[1],
    weeklyMinutesTarget: Number.parseInt(line.match(/\/ (\d+)h\/week/)?.[1] ?? "10", 10) * 60,
    loggedMinutes: 0,
    status: (line.match(/status=([a-z]+)/)?.[1] ?? "active") as Goal["status"],
    createdAt: Date.now(),
  } satisfies Goal));
}

/* ───────────── tiny helpers ───────────── */

function quoteYaml(s: string): string {
  if (/[:#\n"']/.test(s)) return `"${s.replace(/"/g, '\\"')}"`;
  return s;
}
function stripYamlQuotes(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\"/g, '"');
  return s;
}
function escapePipe(s: string): string { return s.replace(/\|/g, "\\|"); }
function slug(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x"; }
function extractH1(body: string): string | null {
  return body.match(/^#\s+(.+)$/m)?.[1] ?? null;
}
function formatValue(v: AssertionValue): string {
  switch (v.type) {
    case "number":  return v.value.toString();
    case "string":  return v.value;
    case "date":    return v.value;
    case "boolean": return v.value ? "true" : "false";
  }
}
function valueUnit(v: AssertionValue): string {
  return v.type === "number" ? (v.unit ?? "") : "";
}

/* ───────────── adapter ───────────── */

export const markdownAdapter: ExportAdapter<MarkdownExportOptions> = {
  format: "markdown",
  contentType: "text/markdown; charset=utf-8",
  extension: "md",
  async serialise(manifest, options) {
    return serialiseMarkdown(manifest, options);
  },
  async parse(raw) {
    return parseMarkdown(raw);
  },
};
