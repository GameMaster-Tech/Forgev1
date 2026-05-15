/**
 * Crossref adapter.
 * Docs: https://api.crossref.org/
 *
 * Crossref is our DOI-authority source. Every paper we ingest should (eventually)
 * have its metadata canonicalised against Crossref.
 */

import type { RetrievedSource, RetrievalQuery } from "./types";

const ENDPOINT = "https://api.crossref.org/works";
const DEFAULT_LIMIT = 20;

/**
 * Polite-pool user-agent per Crossref guidelines. Include a mailto in production
 * via the FORGE_CROSSREF_MAILTO env var to avoid rate-limiting.
 */
function userAgent(): string {
  const mail = typeof process !== "undefined" ? process.env.FORGE_CROSSREF_MAILTO : undefined;
  const suffix = mail ? ` (mailto:${mail})` : "";
  return `Forge/0.1 Veritas-R1 retrieval${suffix}`;
}

export async function crossrefSearch(query: RetrievalQuery): Promise<RetrievedSource[]> {
  const params = new URLSearchParams();
  params.set("query", query.text);
  params.set("rows", String(query.limit ?? DEFAULT_LIMIT));

  const filters: string[] = ["type:journal-article,type:proceedings-article,type:posted-content"];
  if (query.yearFrom) filters.push(`from-pub-date:${query.yearFrom}`);
  if (query.yearTo) filters.push(`until-pub-date:${query.yearTo}`);
  if (query.openAccessOnly) filters.push("has-license:true");
  params.set("filter", filters.join(","));

  // Reduce payload — we only need a small subset.
  params.set(
    "select",
    "DOI,title,author,issued,container-title,publisher,abstract,subject,is-referenced-by-count,URL",
  );

  const res = await fetch(`${ENDPOINT}?${params.toString()}`, {
    headers: { "User-Agent": userAgent(), Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`crossref: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as CrossrefResponse;
  const items = json?.message?.items ?? [];
  return items.map((it) => mapItem(it)).filter((s): s is RetrievedSource => s !== null);
}

export async function crossrefLookupByDoi(doi: string): Promise<RetrievedSource | null> {
  const normalised = doi.trim().toLowerCase();
  if (!normalised) return null;
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(normalised)}`, {
    headers: { "User-Agent": userAgent(), Accept: "application/json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`crossref doi: ${res.status} ${res.statusText}`);

  const json = (await res.json()) as { message?: CrossrefItem };
  const item = json?.message;
  if (!item) return null;
  return mapItem(item);
}

/* ─────────────────────────────────────────────────────────────
 *  Mappers
 * ──────────────────────────────────────────────────────────── */

interface CrossrefResponse {
  message?: {
    items?: CrossrefItem[];
  };
}

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  issued?: { "date-parts"?: number[][] };
  "container-title"?: string[];
  publisher?: string;
  abstract?: string;
  subject?: string[];
  "is-referenced-by-count"?: number;
  URL?: string;
}

function mapItem(item: CrossrefItem): RetrievedSource | null {
  const title = item.title?.[0];
  if (!title) return null;

  const authors =
    item.author?.map((a) => {
      if (a.name) return a.name;
      const parts = [a.given, a.family].filter(Boolean);
      return parts.join(" ");
    }) ?? [];

  const yearParts = item.issued?.["date-parts"]?.[0];
  const year = yearParts && yearParts.length > 0 ? yearParts[0] : undefined;
  const month = yearParts && yearParts.length > 1 ? yearParts[1] : undefined;
  const day = yearParts && yearParts.length > 2 ? yearParts[2] : undefined;
  const publishedDate = year
    ? [year, month ?? 1, day ?? 1]
        .map((n) => String(n).padStart(n === year ? 4 : 2, "0"))
        .join("-")
    : undefined;

  // Crossref returns HTML/JATS-wrapped abstracts; strip tags for our use.
  const abstract = item.abstract ? stripTags(item.abstract) : undefined;

  return {
    id: item.DOI ? `doi:${item.DOI}` : `crossref:${title.slice(0, 40)}`,
    provider: "crossref",
    title,
    authors,
    abstract,
    doi: item.DOI,
    url: item.URL,
    year,
    publishedDate,
    venue: item["container-title"]?.[0],
    publisher: item.publisher,
    citationCount: item["is-referenced-by-count"],
    subjects: item.subject,
    raw: item as unknown as Record<string, unknown>,
  };
}

function stripTags(s: string): string {
  return s
    .replace(/<jats:[^>]+>/g, "")
    .replace(/<\/jats:[^>]+>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
