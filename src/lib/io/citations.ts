/**
 * Citation round-trip — `[[claim:<key>]]` pill preservation across
 * Markdown, Notion, and Google Docs.
 *
 * Format-specific encoding strategies:
 *   • Markdown        — preserved literally as `[[claim:key]]`.
 *   • Notion blocks   — rendered as a `mention` block with metadata.
 *                       On parse, we read the mention's metadata back.
 *   • Google Docs     — encoded as a custom-formatted span with a
 *                       footnote pointer; round-trip is lossy without
 *                       an explicit Forge-side mapping table that
 *                       persists separately.
 *
 * Pure module — no I/O.
 */

const CLAIM_REGEX = /\[\[claim:([a-z0-9_.\-]+)\]\]/gi;

export interface CitationMatch {
  /** Full match including delimiters. */
  raw: string;
  /** Just the key, without `[[claim:` and `]]`. */
  key: string;
  /** Byte offset in the source string. */
  index: number;
}

/** Find every `[[claim:<key>]]` in a string. Pure. */
export function findCitations(text: string): CitationMatch[] {
  if (!text) return [];
  const out: CitationMatch[] = [];
  // Reset stateful flag explicitly so callers can't surprise us.
  const re = new RegExp(CLAIM_REGEX.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ raw: m[0], key: m[1], index: m.index });
  }
  return out;
}

/** Replace each citation with the resolver's output. */
export function rewriteCitations(text: string, resolve: (key: string) => string): string {
  if (!text) return text;
  return text.replace(new RegExp(CLAIM_REGEX.source, "gi"), (_, key: string) => resolve(key));
}

/** Strip citations entirely. Used for plain-text fallback. */
export function stripCitations(text: string): string {
  return rewriteCitations(text, () => "");
}

/** Render every citation as its current numeric/string value via the
 *  lookup. Used when exporting to plain Markdown/Notion without preserving the marker. */
export function inlineCitations(
  text: string,
  lookup: (key: string) => string | undefined,
): string {
  return rewriteCitations(text, (key) => lookup(key) ?? `[[claim:${key}]]`);
}

/* ───────────── Notion mention encoding ───────────── */

/**
 * Notion mention block carries `mention.type = "page"` or `database`.
 * We use a synthetic shape that adapters package into the appropriate
 * Notion API rich-text run.
 */
export interface NotionMention {
  type: "claim";
  key: string;
  /** Plain-text fallback shown for clients that can't render the mention. */
  plain: string;
}

export function citationToNotionMention(match: CitationMatch, fallback: string): NotionMention {
  return {
    type: "claim",
    key: match.key,
    plain: fallback,
  };
}

/* ───────────── Google Docs footnote encoding ───────────── */

/**
 * Google Docs has first-class footnotes. We emit each citation as a
 * footnote whose body contains "claim:<key>". On parse we reconstruct
 * the marker from any footnote whose text starts with "claim:".
 */
export interface GDocFootnote {
  index: number;
  body: string;
}

export function citationsToFootnotes(text: string): { stripped: string; footnotes: GDocFootnote[] } {
  const footnotes: GDocFootnote[] = [];
  let idx = 0;
  const stripped = rewriteCitations(text, (key) => {
    const fnIndex = ++idx;
    footnotes.push({ index: fnIndex, body: `claim:${key}` });
    return `[^${fnIndex}]`;
  });
  return { stripped, footnotes };
}

export function footnotesToCitations(text: string, footnotes: GDocFootnote[]): string {
  const map = new Map(footnotes.map((f) => [f.index, f.body]));
  return text.replace(/\[\^(\d+)\]/g, (_, n: string) => {
    const idx = parseInt(n, 10);
    const body = map.get(idx);
    if (body?.startsWith("claim:")) {
      return `[[claim:${body.slice("claim:".length)}]]`;
    }
    return `[^${n}]`;
  });
}
