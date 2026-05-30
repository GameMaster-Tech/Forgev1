"use client";

/**
 * Workspace export — robust, client-side portability.
 *
 * Reads through the *client* Firestore SDK (the user's own credentials,
 * gated by security rules) rather than a server route that depends on
 * Firebase Admin service-account credentials. That deliberately sidesteps
 * the silent-failure class where a missing service account breaks export:
 * if the user can see their data in the app, they can export it.
 *
 *   • downloadWorkspaceJson — "download my data": every project and
 *     document as one JSON file. The anti-lock-in escape hatch.
 *   • exportProjectMarkdown — a whole project as one Markdown file, each
 *     document a section.
 */

import {
  getUserProjects,
  getProjectDocuments,
  type FirestoreDocument,
  type FirestoreProject,
} from "@/lib/firebase/firestore";
import {
  documentToMarkdown,
  downloadFile,
  filenameSlug,
} from "@/lib/io/document-export";

function tsToIso(t: { toMillis?: () => number } | null | undefined): string | null {
  const ms = typeof t?.toMillis === "function" ? t.toMillis() : 0;
  return ms ? new Date(ms).toISOString() : null;
}

export interface WorkspaceExport {
  exportedAt: string;
  app: "forge";
  version: "v1";
  projectCount: number;
  documentCount: number;
  projects: Array<{
    id: string;
    name: string;
    mode: string;
    status: string;
    systemInstructions: string;
    createdAt: string | null;
    updatedAt: string | null;
    documents: Array<{
      id: string;
      title: string;
      content: string;
      wordCount: number;
      citationCount: number;
      parentId: string | null;
      createdAt: string | null;
      updatedAt: string | null;
    }>;
  }>;
}

/** Gather the entire workspace into a plain, portable object. */
export async function buildWorkspaceExport(userId: string): Promise<WorkspaceExport> {
  const projects = await getUserProjects(userId);
  let documentCount = 0;
  const projectOut = await Promise.all(
    projects.map(async (p: FirestoreProject) => {
      const docs = await getProjectDocuments(p.id, userId);
      documentCount += docs.length;
      return {
        id: p.id,
        name: p.name,
        mode: p.mode,
        status: p.status,
        systemInstructions: p.systemInstructions ?? "",
        createdAt: tsToIso(p.createdAt),
        updatedAt: tsToIso(p.updatedAt),
        documents: docs.map((d: FirestoreDocument) => ({
          id: d.id,
          title: d.title,
          content: d.content ?? "",
          wordCount: d.wordCount ?? 0,
          citationCount: d.citationCount ?? 0,
          parentId: d.parentId ?? null,
          createdAt: tsToIso(d.createdAt),
          updatedAt: tsToIso(d.updatedAt),
        })),
      };
    }),
  );

  return {
    exportedAt: new Date().toISOString(),
    app: "forge",
    version: "v1",
    projectCount: projects.length,
    documentCount,
    projects: projectOut,
  };
}

/** Download the whole workspace as a single JSON file. */
export async function downloadWorkspaceJson(userId: string): Promise<WorkspaceExport> {
  const data = await buildWorkspaceExport(userId);
  const stamp = new Date().toISOString().slice(0, 10);
  downloadFile(`forge-workspace-${stamp}.json`, JSON.stringify(data, null, 2), "application/json");
  return data;
}

/** Combine every document in a project into one Markdown file and download it. */
export function exportProjectMarkdown(projectName: string, docs: FirestoreDocument[]): void {
  const ordered = [...docs].sort(
    (a, b) => (a.updatedAt?.toMillis?.() ?? 0) - (b.updatedAt?.toMillis?.() ?? 0),
  );
  const body = ordered
    .map((d) => documentToMarkdown(d.title || "Untitled document", d.content || ""))
    .join("\n\n---\n\n");
  const header = `# ${projectName}\n\n_${ordered.length} document${ordered.length === 1 ? "" : "s"} · exported ${new Date().toLocaleDateString()}_\n\n---\n\n`;
  downloadFile(`${filenameSlug(projectName)}.md`, header + body, "text/markdown");
}
