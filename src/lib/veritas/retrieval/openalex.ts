/**
 * OpenAlex adapter.
 * Docs: https://docs.openalex.org/
 *
 * OpenAlex is our richest source of concept/entity graph data and is the
 * primary backend for author + venue disambiguation. It is free and requires
 * no key, though supplying a mailto unlocks the "polite pool" with higher
 * throughput.
 */

import type { RetrievedSource, RetrievalQuery } from "./types";

const ENDPOINT = "https://api.openalex.org/works";
const DEFAULT_LIMIT = 20;

function politeSuffix(): string {
  const mail =
    typeof process !== "undefined" ? process.env.FORGE_OPENALEX_MAILTO : undefined;
  return mail ? `&mailto=${encodeURIComponent(mail)}` : "";
}

export async function openAlexSearch(query: RetrievalQuery): Promise<RetrievedSource[]> {
  const perPage = Math.max(1, Math.min(200, query.limit ?? DEFAULT_LIMIT));
  const filters: string[] = ["type:article"];
  if (query.yearFrom) filters.push(`from_publication_date:${query.yearFrom}-01-01`);
  if (query.yearTo) filters.push(`to_publication_date:${query.yearTo}-12-31`);
  if (query.openAccessOnly) filters.push("is_oa:true");

  const url =
    `${ENDPOINT}?search=${encodeURIComponent(query.text)}` +
    `&per_page=${perPage}` +
    `&filter=${encodeURIComponent(filters.join(","))}` +
    politeSuffix();

  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`openalex: ${res.status} ${res.statusText}`);

  const json = (await res.json()) as OpenAlexResponse;
  return (json.results ?? []).map(mapWork).filter((x): x is RetrievedSource => x !== null);
}

/* ─────────────────────────────────────────────────────────────
 *  Mapper
 * ──────────────────────────────────────────────────────────── */

interface OpenAlexResponse {
  results?: OpenAlexWork[];
}

interface OpenAlexWork {
  id?: string;
  doi?: string;
  title?: string;
  display_name?: string;
  publication_year?: number;
  publication_date?: string;
  authorships?: { author?: { display_name?: string } }[];
  primary_location?: { source?: { display_name?: string; publisher?: string } };
  host_venue?: { display_name?: string; publisher?: string };
  cited_by_count?: number;
  abstract_inverted_index?: Record<string, number[]>;
  concepts?: { display_name?: string; score?: number }[];
}

function mapWork(w: OpenAlexWork): RetrievedSource | null {
  const title = w.title ?? w.display_name;
  if (!title) return null;

  const doi = w.doi ? w.doi.replace(/^https?:\/\/doi\.org\//i, "") : undefined;

  return {
    id: w.id ?? (doi ? `doi:${doi}` : `openalex:${title.slice(0, 40)}`),
    provider: "openalex",
    title,
    authors:
      w.authorships
        ?.map((a) => a.author?.display_name)
        .filter((x): x is string => Boolean(x)) ?? [],
    abstract: reconstructAbstract(w.abstract_inverted_index),
    doi,
    url: w.id,
    year: w.publication_year,
    publishedDate: w.publication_date,
    venue:
      w.primary_location?.source?.display_name ?? w.host_venue?.display_name,
    publisher:
      w.primary_location?.source?.publisher ?? w.host_venue?.publisher,
    citationCount: w.cited_by_count,
    subjects: w.concepts
      ?.filter((c) => (c.score ?? 0) > 0.3)
      .map((c) => c.display_name)
      .filter((x): x is string => Boolean(x)),
    raw: w as unknown as Record<string, unknown>,
  };
}

/**
 * OpenAlex serialises abstracts as an inverted index:
 *   { "The": [0], "quick": [1], "brown": [2, 5], ... }
 * This rebuilds the plain text.
 */
function reconstructAbstract(
  index: Record<string, number[]> | undefined,
): string | undefined {
  if (!index) return undefined;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const p of positions) words[p] = word;
  }
  const joined = words.filter(Boolean).join(" ").trim();
  return joined.length > 0 ? joined : undefined;
}
