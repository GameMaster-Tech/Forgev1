/**
 * PubMed E-utilities adapter.
 * Docs: https://www.ncbi.nlm.nih.gov/books/NBK25500/
 *
 * PubMed uses a two-step handshake:
 *   1. ESearch → returns a list of PMIDs matching the query.
 *   2. ESummary → returns metadata for each PMID.
 * We batch step 2 to minimise round-trips.
 */

import type { RetrievedSource, RetrievalQuery } from "./types";

const ESEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const ESUMMARY = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi";

function apiKeyParam(): string {
  const k = typeof process !== "undefined" ? process.env.FORGE_NCBI_API_KEY : undefined;
  return k ? `&api_key=${encodeURIComponent(k)}` : "";
}

export async function pubmedSearch(query: RetrievalQuery): Promise<RetrievedSource[]> {
  const limit = query.limit ?? 20;
  const terms = [query.text];
  if (query.yearFrom && query.yearTo) {
    terms.push(`(${query.yearFrom}:${query.yearTo}[dp])`);
  } else if (query.yearFrom) {
    terms.push(`(${query.yearFrom}:3000[dp])`);
  } else if (query.yearTo) {
    terms.push(`(1900:${query.yearTo}[dp])`);
  }
  const term = terms.join(" AND ");

  const searchUrl =
    `${ESEARCH}?db=pubmed&retmode=json&retmax=${limit}` +
    `&term=${encodeURIComponent(term)}${apiKeyParam()}`;

  const sRes = await fetch(searchUrl);
  if (!sRes.ok) throw new Error(`pubmed esearch: ${sRes.status}`);
  const sJson = (await sRes.json()) as EsearchResponse;
  const ids = sJson.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];

  const summaryUrl =
    `${ESUMMARY}?db=pubmed&retmode=json&id=${ids.join(",")}${apiKeyParam()}`;
  const mRes = await fetch(summaryUrl);
  if (!mRes.ok) throw new Error(`pubmed esummary: ${mRes.status}`);
  const mJson = (await mRes.json()) as EsummaryResponse;

  const results: RetrievedSource[] = [];
  for (const id of ids) {
    const item = mJson.result?.[id];
    if (!item) continue;
    const mapped = mapItem(id, item);
    if (mapped) results.push(mapped);
  }
  return results;
}

/* ─────────────────────────────────────────────────────────────
 *  Types + mapper
 * ──────────────────────────────────────────────────────────── */

interface EsearchResponse {
  esearchresult?: { idlist?: string[] };
}

interface EsummaryResponse {
  result?: Record<string, PubmedItem | undefined>;
}

interface PubmedItem {
  title?: string;
  authors?: { name?: string }[];
  fulljournalname?: string;
  source?: string;
  pubdate?: string;
  elocationid?: string;
  articleids?: { idtype?: string; value?: string }[];
}

function mapItem(pmid: string, item: PubmedItem): RetrievedSource | null {
  if (!item.title) return null;
  const doi = item.articleids?.find((a) => a.idtype === "doi")?.value;
  const yearMatch = item.pubdate?.match(/^\d{4}/);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : undefined;
  return {
    id: doi ? `doi:${doi}` : `pmid:${pmid}`,
    provider: "pubmed",
    title: item.title.replace(/\.$/, ""),
    authors: (item.authors ?? [])
      .map((a) => a.name)
      .filter((x): x is string => Boolean(x)),
    doi,
    url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
    year,
    publishedDate: item.pubdate,
    venue: item.fulljournalname ?? item.source,
  };
}
