"use client";

/**
 * Markdown — a tight, dependency-free renderer for chat messages.
 *
 * Chat content from the agent contains real markdown — links,
 * bold/italic, inline code, headers, code blocks, lists. Rendering
 * it as `whitespace-pre-wrap` plaintext drops the affordances
 * (clickable citations, structure, monospace for snippets) and
 * makes the assistant look amateur.
 *
 * Why hand-rolled instead of `react-markdown`:
 *   • The grammar we actually see in agent output is small —
 *     headers, paragraphs, lists, blockquotes, fences, links,
 *     bold, italic, inline code. A 200-line tokeniser handles all
 *     of it.
 *   • Avoids a 50KB+ dependency for what reduces to a few regex
 *     passes.
 *   • We're rendering trusted-but-sanitised text from our own
 *     server — no need for the full HTML-escaping ceremony, but
 *     we still escape every text node defensively.
 *
 * Block grammar (top-down):
 *   ``` ... ```             fenced code (with optional language)
 *   #, ##, ###              h1 / h2 / h3
 *   >                       blockquote
 *   -  / *  / + (item)      unordered list item
 *   N. (item)               ordered list item
 *   (blank line)            paragraph break
 *   (default)               paragraph
 *
 * Inline grammar:
 *   `code`
 *   **bold** / __bold__
 *   *italic* / _italic_
 *   [text](url)             only `https?:` and same-origin paths
 *   bare http(s) URL        auto-linked
 *
 * Links are opened in a new tab with rel="noopener noreferrer".
 */

import { useMemo, type ReactNode } from "react";

interface MarkdownProps {
  text: string;
  /** Apply a tight prose style suitable for chat. */
  tight?: boolean;
  className?: string;
}

export function Markdown({ text, tight = false, className = "" }: MarkdownProps) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <div
      className={[
        "forge-md text-[15px] leading-[1.65] text-foreground",
        tight ? "space-y-2" : "space-y-3",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {blocks.map((b, i) => (
        <BlockView key={i} block={b} />
      ))}
    </div>
  );
}

/* ─────────────────────── block parser ─────────────────────── */

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "code"; lang: string; body: string }
  | { kind: "quote"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "hr" };

function parseBlocks(input: string): Block[] {
  if (!input) return [];
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const out: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      const lang = fence[1] ?? "";
      i++;
      const body: string[] = [];
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      // Consume the closing fence if present.
      if (i < lines.length) i++;
      out.push({ kind: "code", lang, body: body.join("\n") });
      continue;
    }

    // Blank → paragraph break.
    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      out.push({ kind: "hr" });
      i++;
      continue;
    }

    // Headings.
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      out.push({
        kind: "h",
        level: h[1].length as 1 | 2 | 3,
        text: h[2].trim(),
      });
      i++;
      continue;
    }

    // Blockquote — consume contiguous `> ` lines as one quote.
    if (/^>\s?/.test(line)) {
      const parts: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        parts.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push({ kind: "quote", text: parts.join(" ") });
      continue;
    }

    // Unordered list — consume contiguous `-` / `*` / `+` items.
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      out.push({ kind: "ul", items });
      continue;
    }

    // Ordered list — consume contiguous `N.` items.
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      out.push({ kind: "ol", items });
      continue;
    }

    // Default — accumulate non-blank lines into one paragraph.
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^#{1,3}\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push({ kind: "p", text: para.join(" ") });
  }
  return out;
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "p":
      return <p className="text-foreground">{renderInline(block.text)}</p>;
    case "h":
      if (block.level === 1)
        return (
          <h2 className="font-display font-bold text-[20px] text-foreground tracking-[-0.018em] leading-tight pt-2">
            {renderInline(block.text)}
          </h2>
        );
      if (block.level === 2)
        return (
          <h3 className="font-display font-bold text-[17px] text-foreground tracking-[-0.014em] leading-tight pt-1">
            {renderInline(block.text)}
          </h3>
        );
      return (
        <h4 className="font-display font-semibold text-[15px] text-foreground tracking-[-0.012em] leading-tight pt-1">
          {renderInline(block.text)}
        </h4>
      );
    case "quote":
      return (
        <blockquote className="border-l-2 border-violet/40 pl-3 text-foreground/85 italic">
          {renderInline(block.text)}
        </blockquote>
      );
    case "code":
      return (
        <pre className="bg-foreground/[0.04] border border-border px-3 py-2.5 overflow-x-auto text-[13px] font-mono leading-snug whitespace-pre">
          <code>{block.body}</code>
        </pre>
      );
    case "ul":
      return (
        <ul className="list-disc pl-5 space-y-1 marker:text-muted">
          {block.items.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol className="list-decimal pl-5 space-y-1 marker:text-muted marker:font-medium">
          {block.items.map((it, i) => (
            <li key={i}>{renderInline(it)}</li>
          ))}
        </ol>
      );
    case "hr":
      return <hr className="border-border" />;
  }
}

/* ─────────────────────── inline parser ─────────────────────── */

/**
 * Inline tokeniser. Walks left-to-right, peeling off the
 * highest-priority match at each position and emitting React
 * nodes. Priority (highest first):
 *
 *   1. inline code   `…`
 *   2. bold          **…**  / __…__
 *   3. italic        *…*    / _…_
 *   4. markdown link [txt](url)
 *   5. bare URL      https?://…
 *   6. literal text
 */
function renderInline(input: string): ReactNode[] {
  const out: ReactNode[] = [];
  let remaining = input;
  let key = 0;

  while (remaining.length > 0) {
    // 1. inline code
    const code = matchOnce(remaining, /`([^`]+)`/);
    // 2. bold
    const bold = matchOnce(remaining, /\*\*([^*\n]+)\*\*|__([^_\n]+)__/);
    // 3. italic
    const italic = matchOnce(remaining, /(?<![*\w])\*([^*\n]+)\*(?!\*)|(?<![_\w])_([^_\n]+)_(?!_)/);
    // 4. markdown link
    const link = matchOnce(remaining, /\[([^\]]+)\]\(([^)\s]+)\)/);
    // 5. bare URL
    const bare = matchOnce(remaining, /\bhttps?:\/\/[^\s<>"']+/);

    const candidates: { idx: number; len: number; node: ReactNode; consumed: number }[] = [];
    if (code) {
      candidates.push({
        idx: code.index,
        len: code.match.length,
        consumed: code.match.length,
        node: (
          <code
            key={`c-${key++}`}
            className="bg-foreground/[0.06] border border-border px-[0.3em] py-[0.1em] text-[0.92em] font-mono"
          >
            {code.groups[0]}
          </code>
        ),
      });
    }
    if (bold) {
      candidates.push({
        idx: bold.index,
        len: bold.match.length,
        consumed: bold.match.length,
        node: (
          <strong key={`b-${key++}`} className="font-semibold text-foreground">
            {bold.groups[0] ?? bold.groups[1]}
          </strong>
        ),
      });
    }
    if (italic) {
      candidates.push({
        idx: italic.index,
        len: italic.match.length,
        consumed: italic.match.length,
        node: (
          <em key={`i-${key++}`} className="italic">
            {italic.groups[0] ?? italic.groups[1]}
          </em>
        ),
      });
    }
    if (link && isSafeUrl(link.groups[1])) {
      candidates.push({
        idx: link.index,
        len: link.match.length,
        consumed: link.match.length,
        node: (
          <a
            key={`l-${key++}`}
            href={link.groups[1]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet underline-offset-2 hover:underline"
          >
            {link.groups[0]}
          </a>
        ),
      });
    }
    if (bare && isSafeUrl(bare.match)) {
      candidates.push({
        idx: bare.index,
        len: bare.match.length,
        consumed: bare.match.length,
        node: (
          <a
            key={`u-${key++}`}
            href={bare.match}
            target="_blank"
            rel="noopener noreferrer"
            className="text-violet underline-offset-2 hover:underline"
          >
            {hostnameOf(bare.match) || bare.match}
          </a>
        ),
      });
    }

    if (candidates.length === 0) {
      out.push(remaining);
      break;
    }

    // Pick the earliest match; ties broken by longer match (greedier).
    candidates.sort((a, b) => a.idx - b.idx || b.len - a.len);
    const next = candidates[0];

    if (next.idx > 0) {
      out.push(remaining.slice(0, next.idx));
    }
    out.push(next.node);
    remaining = remaining.slice(next.idx + next.consumed);
  }

  return out;
}

function matchOnce(
  input: string,
  re: RegExp,
): { index: number; match: string; groups: (string | undefined)[] } | null {
  const m = re.exec(input);
  if (!m) return null;
  return {
    index: m.index,
    match: m[0],
    groups: m.slice(1),
  };
}

function isSafeUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url.startsWith("/")) return true;
  return /^https?:\/\//i.test(url);
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}
