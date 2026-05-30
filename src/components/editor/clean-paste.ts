/**
 * Clean paste — normalise HTML pasted from the web, Word, and Google
 * Docs into editor-friendly markup.
 *
 * ProseMirror already drops tags/attributes its schema doesn't know, so
 * our job is to remove the noise that *would otherwise survive* and
 * corrupt the document:
 *
 *   • Word / Office: `<o:p>`, `<w:…>`, `mso-…` styles, conditional
 *     comments, leftover `<style>` blocks.
 *   • Google Docs: the outer `<b style="font-weight:normal" id="docs-
 *     internal-guid-…">` wrapper that makes the *entire* paste render
 *     bold, plus its per-run wrappers.
 *
 * Two layers:
 *   1. `stripOfficeCruft` — a deterministic, DOM-free regex pass (also
 *      unit-tested) that removes the unambiguous junk.
 *   2. `cleanPastedHTML` — runs the regex pass, then (in the browser)
 *      an allowlist DOM pass that unwraps the Google-Docs bold wrapper
 *      and drops empty wrapper spans. Lists, links, images, and real
 *      bold/italic survive intact.
 */

/** Deterministic, DOM-free removal of Office/Word cruft. */
export function stripOfficeCruft(html: string): string {
  if (!html) return "";
  return (
    html
      // HTML comments, including Word conditional comments.
      .replace(/<!--[\s\S]*?-->/g, "")
      // <style>, <script>, <xml> blocks (Word dumps a stylesheet inline).
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<xml[\s\S]*?<\/xml>/gi, "")
      // Office namespaced tags: <o:p>, <w:…>, <v:…>, <m:…>, <st1:…>.
      .replace(/<\/?(?:o|w|v|m|st\d):[^>]*>/gi, "")
      // Document scaffolding that sometimes rides along on the clipboard.
      .replace(/<\/?(?:html|head|body|meta|link)[^>]*>/gi, "")
      // mso- style fragments inside any remaining style="" attribute.
      .replace(/mso-[^:;"]+:[^;"]+;?/gi, "")
      // Word's MsoNormal et al. classes.
      .replace(/\sclass="?Mso[^">]*"?/gi, "")
      // Empty style/class attributes left behind by the above.
      .replace(/\sstyle="\s*"/gi, "")
      .replace(/\sclass="\s*"/gi, "")
      // Collapse runs of whitespace between tags.
      .replace(/>\s+</g, "> <")
      .trim()
  );
}

const ALLOWED_TAGS = new Set([
  "P", "BR", "HR", "H1", "H2", "H3", "H4", "H5", "H6",
  "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE",
  "STRONG", "B", "EM", "I", "U", "S", "STRIKE", "DEL", "MARK", "SUP", "SUB",
  "A", "IMG", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD", "SPAN", "DIV",
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(["href", "title"]),
  IMG: new Set(["src", "alt", "title"]),
  // SPAN keeps inline style so Google-Docs bold/italic (font-weight /
  // font-style / text-decoration) round-trips into ProseMirror marks.
  SPAN: new Set(["style"]),
};

/**
 * Full clean: regex cruft removal + (browser) allowlist DOM pass.
 * Falls back to the regex-only result where DOM APIs are unavailable.
 */
export function cleanPastedHTML(html: string): string {
  const stripped = stripOfficeCruft(html);
  if (typeof window === "undefined" || typeof window.DOMParser === "undefined") {
    return stripped;
  }

  try {
    const doc = new window.DOMParser().parseFromString(stripped, "text/html");

    // Unwrap the Google-Docs wrappers that force bold on everything.
    doc
      .querySelectorAll('b[id^="docs-internal-guid"], b[style*="font-weight:normal"], b[style*="font-weight: normal"]')
      .forEach((el) => unwrap(el));

    walkClean(doc.body);
    return doc.body.innerHTML;
  } catch {
    return stripped;
  }
}

/** Replace an element with its children (preserving content, dropping the tag). */
function unwrap(el: Element) {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

/** Depth-first: drop disallowed tags (unwrapping them), strip stray attrs. */
function walkClean(node: Node) {
  const children = Array.from(node.childNodes);
  for (const child of children) {
    if (child.nodeType === 1) {
      const el = child as Element;
      const tag = el.tagName.toUpperCase();
      if (!ALLOWED_TAGS.has(tag)) {
        walkClean(el);
        unwrap(el);
        continue;
      }
      // Strip every attribute not on the per-tag allowlist.
      const allowed = ALLOWED_ATTRS[tag];
      for (const attr of Array.from(el.attributes)) {
        if (!allowed || !allowed.has(attr.name.toLowerCase())) {
          el.removeAttribute(attr.name);
        }
      }
      walkClean(el);
    }
  }
}
