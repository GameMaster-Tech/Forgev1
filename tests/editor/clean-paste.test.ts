import { describe, it, expect } from "vitest";
import { stripOfficeCruft, cleanPastedHTML } from "@/components/editor/clean-paste";

describe("stripOfficeCruft", () => {
  it("removes HTML and Word conditional comments", () => {
    const html = "<p>Keep</p><!--[if gte mso 9]><xml>junk</xml><![endif]--><!-- note -->";
    const out = stripOfficeCruft(html);
    expect(out).toContain("Keep");
    expect(out).not.toContain("mso");
    expect(out).not.toContain("note");
  });

  it("strips <style> and <script> blocks", () => {
    const html = '<style>p{mso-x:1}</style><p>Body</p><script>alert(1)</script>';
    const out = stripOfficeCruft(html);
    expect(out).toContain("Body");
    expect(out).not.toContain("alert");
    expect(out).not.toContain("<style");
  });

  it("removes Office namespaced tags like <o:p>", () => {
    const html = "<p>Hi<o:p></o:p></p><w:sdt>x</w:sdt>";
    const out = stripOfficeCruft(html);
    expect(out).not.toContain("o:p");
    expect(out).not.toContain("w:sdt");
    expect(out).toContain("Hi");
  });

  it("strips mso- style fragments and MsoNormal classes", () => {
    const html = '<p class="MsoNormal" style="mso-bidi-font-weight:normal;color:red">T</p>';
    const out = stripOfficeCruft(html);
    expect(out).not.toContain("mso-");
    expect(out).not.toContain("MsoNormal");
    expect(out).toContain("T");
  });

  it("returns empty string for empty input", () => {
    expect(stripOfficeCruft("")).toBe("");
  });
});

describe("cleanPastedHTML (no-DOM fallback path under node)", () => {
  it("delegates to stripOfficeCruft when DOMParser is unavailable", () => {
    // vitest's default environment is node — no window/DOMParser — so this
    // exercises the regex fallback branch.
    const html = "<p>Hello<o:p></o:p></p>";
    const out = cleanPastedHTML(html);
    expect(out).toContain("Hello");
    expect(out).not.toContain("o:p");
  });
});
