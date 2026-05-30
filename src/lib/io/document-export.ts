/**
 * Single-document export — client-side, dependency-light.
 *
 * The project-level export (`/api/projects/[pid]/export`) builds a rich
 * manifest server-side. For a single document the user just wants the
 * prose out, fast, offline-capable, with no round-trip. This module turns
 * the editor's HTML into:
 *
 *   • Markdown  — via Turndown (lossless for headings, lists, links,
 *                 emphasis, blockquotes, code, images).
 *   • HTML      — a standalone, styled document that opens cleanly in any
 *                 browser and prints to PDF.
 *
 * Both download through a Blob + anchor so they work entirely on the
 * client with no server dependency (and therefore no Firebase Admin
 * credential surface to fail on).
 */

import TurndownService from "turndown";

let _turndown: TurndownService | null = null;

function turndown(): TurndownService {
  if (_turndown) return _turndown;
  const td = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "_",
  });
  // Preserve underline + strikethrough that core Turndown drops.
  td.addRule("underline", {
    filter: ["u"],
    replacement: (content) => `<u>${content}</u>`,
  });
  td.addRule("strikethrough", {
    filter: (node) => node.nodeName === "S" || node.nodeName === "DEL" || node.nodeName === "STRIKE",
    replacement: (content) => `~~${content}~~`,
  });
  _turndown = td;
  return td;
}

/** Convert editor HTML to a Markdown string with an H1 title. */
export function documentToMarkdown(title: string, html: string): string {
  const body = turndown().turndown(html || "");
  const heading = (title || "Untitled document").trim();
  return `# ${heading}\n\n${body}\n`;
}

/** Wrap editor HTML in a standalone, print-friendly HTML document. */
export function documentToHtml(title: string, html: string): string {
  const safeTitle = escapeHtml((title || "Untitled document").trim());
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    line-height: 1.65;
    max-width: 46rem;
    margin: 3rem auto;
    padding: 0 1.25rem;
    color: #1a1a1f;
    background: #fff;
  }
  h1, h2, h3, h4 { font-weight: 700; line-height: 1.2; letter-spacing: -0.02em; }
  h1 { font-size: 2.25rem; margin: 0 0 1.5rem; }
  a { color: #6d34d9; }
  blockquote { border-left: 3px solid #6d34d9; margin: 1rem 0; padding: 0.25rem 0 0.25rem 1rem; color: #444; }
  pre { background: #f4f4f6; padding: 1rem; overflow-x: auto; border-radius: 4px; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; }
  img { max-width: 100%; height: auto; }
  hr { border: 0; border-top: 1px solid #e5e5ea; margin: 2rem 0; }
  @media (prefers-color-scheme: dark) {
    body { color: #e8e8ee; background: #131318; }
    pre { background: #1e1e26; }
    blockquote { color: #b0b0ba; }
    hr { border-top-color: #2a2a33; }
  }
</style>
</head>
<body>
<h1>${safeTitle}</h1>
${html || ""}
</body>
</html>
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Filesystem-safe slug for the download filename. */
export function filenameSlug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "document"
  );
}

/** Trigger a browser download of `content` as `filename`. */
export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick so the click has time to dispatch.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Export a document as Markdown and download it. */
export function exportDocumentMarkdown(title: string, html: string) {
  downloadFile(`${filenameSlug(title)}.md`, documentToMarkdown(title, html), "text/markdown");
}

/** Export a document as standalone HTML and download it. */
export function exportDocumentHtml(title: string, html: string) {
  downloadFile(`${filenameSlug(title)}.html`, documentToHtml(title, html), "text/html");
}

/**
 * Open the document in a print-ready window and invoke the browser print
 * dialog — the dependency-free path to a PDF ("Save as PDF" in print).
 * Returns false when a popup blocker prevented the window from opening.
 */
export function printDocument(title: string, html: string): boolean {
  const win = window.open("", "_blank", "noopener,noreferrer,width=820,height=1000");
  if (!win) return false;
  win.document.open();
  win.document.write(documentToHtml(title, html));
  win.document.close();
  // Give the new document a tick to lay out before printing.
  win.addEventListener("load", () => {
    win.focus();
    win.print();
  });
  // Fallback for browsers that fire load before the listener attaches.
  setTimeout(() => {
    try {
      win.focus();
      win.print();
    } catch {
      /* already printed or closed */
    }
  }, 400);
  return true;
}
