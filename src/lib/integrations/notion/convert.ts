/**
 * Notion → TipTap converter.
 *
 * Converts a tree of Notion blocks (as returned by
 * `/v1/blocks/{id}/children`) into the HTML string the Forge editor
 * stores in `documents/{docId}.content`. The TipTap ProseMirror
 * schema is a subset of HTML — we deliberately emit a small,
 * predictable vocabulary so re-syncing the same page is idempotent.
 *
 * Coverage:
 *   • paragraph, heading_1/2/3
 *   • bulleted_list_item, numbered_list_item, to_do, toggle
 *   • quote, callout, code (with language), divider, equation
 *   • image, video, bookmark, embed (rendered as anchor + caption)
 *   • table_of_contents, child_page (rendered as anchor)
 *   • link_to_page (rendered as anchor — we don't dereference)
 *
 * What we deliberately drop:
 *   • column / column_list (Notion's multi-column → flat HTML)
 *   • table blocks (handled by a separate sync path into DataTable
 *     when the parent is a database)
 *   • unsupported / unknown block types — preserved as plain text
 *     so nothing silently disappears
 *
 * Server-only? No — pure transformer. Safe everywhere.
 */

import type { NotionBlock, NotionRichText } from "./types";

const MAX_DEPTH = 8;

interface ConvertOptions {
  /** Children of each block-id (recursive bodies). The caller fetches
   * children for any block where `has_children: true` and passes the
   * map in. We render iteratively without re-fetching. */
  childrenByParent?: Map<string, NotionBlock[]>;
}

/** Convert a flat block list into TipTap-compatible HTML. */
export function blocksToHtml(
  blocks: NotionBlock[],
  options: ConvertOptions = {},
): string {
  const childrenByParent = options.childrenByParent ?? new Map();
  return renderList(blocks, childrenByParent, 0);
}

function renderList(
  blocks: NotionBlock[],
  childrenByParent: Map<string, NotionBlock[]>,
  depth: number,
): string {
  if (depth > MAX_DEPTH) return "";

  let out = "";
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    // Group consecutive list items into a single <ul>/<ol>.
    if (b.type === "bulleted_list_item") {
      let j = i;
      const items: string[] = [];
      while (j < blocks.length && blocks[j].type === "bulleted_list_item") {
        items.push(renderListItem(blocks[j], childrenByParent, depth));
        j += 1;
      }
      out += `<ul>${items.join("")}</ul>`;
      i = j;
      continue;
    }
    if (b.type === "numbered_list_item") {
      let j = i;
      const items: string[] = [];
      while (j < blocks.length && blocks[j].type === "numbered_list_item") {
        items.push(renderListItem(blocks[j], childrenByParent, depth));
        j += 1;
      }
      out += `<ol>${items.join("")}</ol>`;
      i = j;
      continue;
    }
    if (b.type === "to_do") {
      let j = i;
      const items: string[] = [];
      while (j < blocks.length && blocks[j].type === "to_do") {
        items.push(renderTodoItem(blocks[j], childrenByParent, depth));
        j += 1;
      }
      out += `<ul data-type="taskList">${items.join("")}</ul>`;
      i = j;
      continue;
    }
    out += renderBlock(b, childrenByParent, depth);
    i += 1;
  }
  return out;
}

function renderBlock(
  b: NotionBlock,
  childrenByParent: Map<string, NotionBlock[]>,
  depth: number,
): string {
  switch (b.type) {
    case "paragraph": {
      const text = renderRich(b.paragraph?.rich_text ?? []);
      const inner = text || "&nbsp;";
      const nested = renderChildren(b, childrenByParent, depth);
      return `<p>${inner}</p>${nested}`;
    }
    case "heading_1":
      return `<h1>${renderRich(b.heading_1?.rich_text ?? [])}</h1>`;
    case "heading_2":
      return `<h2>${renderRich(b.heading_2?.rich_text ?? [])}</h2>`;
    case "heading_3":
      return `<h3>${renderRich(b.heading_3?.rich_text ?? [])}</h3>`;
    case "quote": {
      const text = renderRich(b.quote?.rich_text ?? []);
      const nested = renderChildren(b, childrenByParent, depth);
      return `<blockquote><p>${text}</p>${nested}</blockquote>`;
    }
    case "callout": {
      const text = renderRich(b.callout?.rich_text ?? []);
      const icon = b.callout?.icon?.emoji ?? "💡";
      return `<blockquote><p><strong>${escapeHtml(icon)}</strong> ${text}</p></blockquote>`;
    }
    case "code": {
      const code = (b.code?.rich_text ?? [])
        .map((r) => r.plain_text)
        .join("");
      const language = b.code?.language ?? "";
      const langAttr = language ? ` class="language-${escapeAttr(language)}"` : "";
      return `<pre><code${langAttr}>${escapeHtml(code)}</code></pre>`;
    }
    case "divider":
      return `<hr/>`;
    case "equation":
      return `<p><code>${escapeHtml(b.equation?.expression ?? "")}</code></p>`;
    case "toggle": {
      const summary = renderRich(b.toggle?.rich_text ?? []);
      const body = renderChildren(b, childrenByParent, depth);
      return `<details><summary>${summary}</summary>${body}</details>`;
    }
    case "image": {
      const url = imageUrl(b);
      const caption = b.image?.caption ? renderRich(b.image.caption) : "";
      if (!url) return "";
      const alt = stripTags(caption) || "Image";
      const captionHtml = caption ? `<p><em>${caption}</em></p>` : "";
      return `<figure><img src="${escapeAttr(url)}" alt="${escapeAttr(alt)}"/>${captionHtml}</figure>`;
    }
    case "video": {
      const url = videoUrl(b);
      if (!url) return "";
      return `<p><a href="${escapeAttr(url)}">${escapeHtml(url)}</a></p>`;
    }
    case "bookmark":
    case "embed": {
      const url = b.bookmark?.url ?? b.embed?.url ?? "";
      if (!url) return "";
      const caption = b.bookmark?.caption ? renderRich(b.bookmark.caption) : "";
      return `<p><a href="${escapeAttr(url)}">${escapeHtml(caption || url)}</a></p>`;
    }
    case "table_of_contents":
      return `<p><em>Table of contents</em></p>`;
    case "child_page": {
      const title = b.child_page?.title ?? "Untitled page";
      return `<p><strong>↳ ${escapeHtml(title)}</strong></p>`;
    }
    case "child_database": {
      const title = b.child_database?.title ?? "Untitled database";
      return `<p><strong>▦ ${escapeHtml(title)}</strong></p>`;
    }
    case "link_to_page": {
      const target = b.link_to_page?.page_id ?? b.link_to_page?.database_id ?? "";
      return `<p><a href="#notion-${escapeAttr(target)}">Linked page</a></p>`;
    }
    default:
      // Unknown block — preserve as plain text so nothing silently
      // disappears. Notion adds new block types over time; this keeps
      // us from regressing on shape changes.
      return `<p><em>[unsupported notion block: ${escapeHtml(b.type)}]</em></p>`;
  }
}

function renderListItem(
  b: NotionBlock,
  childrenByParent: Map<string, NotionBlock[]>,
  depth: number,
): string {
  const payload =
    b.type === "bulleted_list_item"
      ? b.bulleted_list_item
      : b.numbered_list_item;
  const text = renderRich(payload?.rich_text ?? []);
  const nested = renderChildren(b, childrenByParent, depth);
  return `<li><p>${text || "&nbsp;"}</p>${nested}</li>`;
}

function renderTodoItem(
  b: NotionBlock,
  childrenByParent: Map<string, NotionBlock[]>,
  depth: number,
): string {
  const text = renderRich(b.to_do?.rich_text ?? []);
  const checked = b.to_do?.checked ? " data-checked=\"true\"" : "";
  const nested = renderChildren(b, childrenByParent, depth);
  return `<li data-type="taskItem"${checked}><label><input type="checkbox"${b.to_do?.checked ? " checked" : ""}/></label><div><p>${text || "&nbsp;"}</p>${nested}</div></li>`;
}

function renderChildren(
  b: NotionBlock,
  childrenByParent: Map<string, NotionBlock[]>,
  depth: number,
): string {
  if (!b.has_children) return "";
  const kids = childrenByParent.get(b.id);
  if (!kids || kids.length === 0) return "";
  return renderList(kids, childrenByParent, depth + 1);
}

/* ─────────────────────────── rich text ─────────────────────────── */

function renderRich(parts: NotionRichText[]): string {
  return parts.map(renderOneRich).join("");
}

function renderOneRich(r: NotionRichText): string {
  let text = escapeHtml(r.plain_text ?? "");
  if (!text) return "";
  const a = r.annotations ?? {};
  if (a.code) text = `<code>${text}</code>`;
  if (a.bold) text = `<strong>${text}</strong>`;
  if (a.italic) text = `<em>${text}</em>`;
  if (a.strikethrough) text = `<s>${text}</s>`;
  if (a.underline) text = `<u>${text}</u>`;
  const href = r.href ?? r.text?.link?.url;
  if (href) text = `<a href="${escapeAttr(href)}">${text}</a>`;
  return text;
}

/* ─────────────────────────── helpers ─────────────────────────── */

function imageUrl(b: NotionBlock): string | null {
  if (!b.image) return null;
  return b.image.external?.url ?? b.image.file?.url ?? null;
}

function videoUrl(b: NotionBlock): string | null {
  if (!b.video) return null;
  return b.video.external?.url ?? b.video.file?.url ?? null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}

/* ─────────────────────────── titles ─────────────────────────── */

/**
 * Pull the title out of a Notion page's `properties`. Pages from
 * regular workspaces have a property of type `"title"` (key is
 * arbitrary, often "Name"); database rows always have a single
 * `"title"` property. Falls back to "Untitled" so the doc list is
 * never blank.
 */
export function pageTitle(
  properties: Record<string, { type: string; title?: NotionRichText[] }>,
): string {
  for (const value of Object.values(properties ?? {})) {
    if (value.type === "title" && value.title) {
      const text = value.title.map((r) => r.plain_text ?? "").join("").trim();
      if (text) return text;
    }
  }
  return "Untitled";
}
