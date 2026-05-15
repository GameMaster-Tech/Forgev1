/**
 * arXiv adapter.
 * Docs: https://info.arxiv.org/help/api/
 *
 * arXiv returns Atom XML. We parse it with a small, dependency-free parser —
 * for now we regex it (simple feed shape). In Phase 1 we'll swap this for a
 * proper streaming XML parser if we start ingesting at scale.
 */

import type { RetrievedSource, RetrievalQuery } from "./types";

const ENDPOINT = "https://export.arxiv.org/api/query";
const DEFAULT_LIMIT = 20;

export async function arxivSearch(query: RetrievalQuery): Promise<RetrievedSource[]> {
  const searchQuery = `all:${quote(query.text)}`;
  const params = new URLSearchParams({
    search_query: searchQuery,
    start: "0",
    max_results: String(query.limit ?? DEFAULT_LIMIT),
    sortBy: "relevance",
    sortOrder: "descending",
  });

  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    headers: { Accept: "application/atom+xml" },
  });
  if (!res.ok) throw new Error(`arxiv: ${res.status} ${res.statusText}`);

  const xml = await res.text();
  const entries = parseEntries(xml);
  const out: RetrievedSource[] = [];
  for (const e of entries) {
    const mapped = mapEntry(e);
    if (!mapped) continue;
    if (query.yearFrom && mapped.year && mapped.year < query.yearFrom) continue;
    if (query.yearTo && mapped.year && mapped.year > query.yearTo) continue;
    out.push(mapped);
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────
 *  Parser
 * ──────────────────────────────────────────────────────────── */

interface ArxivEntry {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  authors: string[];
  primaryCategory?: string;
  doi?: string;
  pdfUrl?: string;
}

function parseEntries(xml: string): ArxivEntry[] {
  const blocks = xml.split(/<entry>/).slice(1);
  const entries: ArxivEntry[] = [];
  for (const blockRaw of blocks) {
    const block = blockRaw.split(/<\/entry>/)[0] ?? "";
    entries.push({
      id: extractText(block, "id"),
      title: extractText(block, "title"),
      summary: extractText(block, "summary"),
      published: extractText(block, "published"),
      authors: extractAuthors(block),
      primaryCategory: extractPrimaryCategory(block),
      doi: extractText(block, "arxiv:doi"),
      pdfUrl: extractPdfUrl(block),
    });
  }
  return entries;
}

function extractText(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${escape(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escape(tag)}>`, "i");
  const m = block.match(re);
  if (!m) return undefined;
  return unescapeXml(m[1].trim().replace(/\s+/g, " "));
}

function extractAuthors(block: string): string[] {
  const out: string[] = [];
  const re = /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block))) {
    out.push(unescapeXml(m[1].trim().replace(/\s+/g, " ")));
  }
  return out;
}

function extractPrimaryCategory(block: string): string | undefined {
  const m = block.match(/<arxiv:primary_category[^>]*term="([^"]+)"/i);
  return m ? m[1] : undefined;
}

function extractPdfUrl(block: string): string | undefined {
  const m = block.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/i);
  return m ? m[1] : undefined;
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unescapeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/* ─────────────────────────────────────────────────────────────
 *  Mapper
 * ──────────────────────────────────────────────────────────── */

function mapEntry(e: ArxivEntry): RetrievedSource | null {
  if (!e.title || !e.id) return null;
  const arxivId = e.id.replace(/^https?:\/\/arxiv\.org\/abs\//i, "");
  const year = e.published ? parseInt(e.published.slice(0, 4), 10) : undefined;
  return {
    id: e.doi ? `doi:${e.doi}` : `arxiv:${arxivId}`,
    provider: "arxiv",
    title: e.title,
    authors: e.authors,
    abstract: e.summary,
    doi: e.doi,
    url: e.pdfUrl ?? e.id,
    year: Number.isFinite(year) ? year : undefined,
    publishedDate: e.published,
    subjects: e.primaryCategory ? [e.primaryCategory] : undefined,
  };
}

function quote(s: string): string {
  // arXiv accepts quoted phrases for multi-word queries.
  if (/\s/.test(s)) return `"${s.replace(/"/g, '')}"`;
  return s;
}
