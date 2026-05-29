import { describe, it, expect } from "vitest";
import {
  documentToMarkdown,
  documentToHtml,
  filenameSlug,
} from "@/lib/io/document-export";

describe("documentToMarkdown", () => {
  it("prepends the title as an H1", () => {
    const md = documentToMarkdown("My Report", "<p>Hello world.</p>");
    expect(md.startsWith("# My Report")).toBe(true);
    expect(md).toContain("Hello world.");
  });

  it("converts headings, lists, emphasis, and links to Markdown", () => {
    const html =
      "<h2>Section</h2><ul><li>one</li><li>two</li></ul>" +
      '<p><strong>bold</strong> and <em>italic</em> and <a href="https://x.com">link</a></p>';
    const md = documentToMarkdown("Doc", html);
    expect(md).toContain("## Section");
    expect(md).toMatch(/^-\s+one$/m);
    expect(md).toMatch(/^-\s+two$/m);
    expect(md).toContain("**bold**");
    expect(md).toContain("_italic_");
    expect(md).toContain("[link](https://x.com)");
  });

  it("preserves underline and strikethrough that core Turndown drops", () => {
    const md = documentToMarkdown("Doc", "<p><u>under</u> <s>struck</s></p>");
    expect(md).toContain("<u>under</u>");
    expect(md).toContain("~~struck~~");
  });

  it("falls back to a default title when empty", () => {
    const md = documentToMarkdown("", "<p>body</p>");
    expect(md.startsWith("# Untitled document")).toBe(true);
  });

  it("handles empty content without throwing", () => {
    expect(() => documentToMarkdown("Title", "")).not.toThrow();
  });
});

describe("documentToHtml", () => {
  it("produces a standalone document with escaped title and embedded body", () => {
    const html = documentToHtml("A <b>title</b> & more", "<p>body content</p>");
    expect(html).toContain("<!doctype html>");
    // Title is escaped in <title> and <h1>.
    expect(html).toContain("A &lt;b&gt;title&lt;/b&gt; &amp; more");
    // Body HTML is embedded verbatim.
    expect(html).toContain("<p>body content</p>");
  });
});

describe("filenameSlug", () => {
  it("lowercases, replaces non-alphanumerics with hyphens, and trims", () => {
    expect(filenameSlug("My Cool Doc!")).toBe("my-cool-doc");
    expect(filenameSlug("  spaced  out  ")).toBe("spaced-out");
  });

  it("falls back to 'document' when nothing usable remains", () => {
    expect(filenameSlug("!!!")).toBe("document");
    expect(filenameSlug("")).toBe("document");
  });
});
