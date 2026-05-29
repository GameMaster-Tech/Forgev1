"use client";

/**
 * DocumentOutline — a live table-of-contents rail for the editor.
 *
 * Reads heading nodes straight from the Tiptap document and re-derives
 * the list on every `update`, so it tracks edits in real time. Clicking
 * an entry scrolls the matching heading into view; the active entry is
 * highlighted by watching the editor's own scroll container.
 *
 * Rendered as a flex sibling in the document workspace (not absolutely
 * positioned) so it claims real layout space and never overlaps the
 * writing column. It collapses to nothing below `xl` and whenever the
 * document has fewer than two headings — a single heading is not an
 * outline worth showing.
 */

import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";

interface Heading {
  pos: number;
  level: number;
  text: string;
}

const ACTIVE_OFFSET = 120;

function collectHeadings(editor: Editor): Heading[] {
  const out: Heading[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const text = node.textContent.trim();
      out.push({ pos, level: (node.attrs.level as number) ?? 1, text });
    }
    return true;
  });
  return out;
}

/** Nearest scrollable ancestor of the ProseMirror surface. */
function getScrollParent(node: HTMLElement): HTMLElement | null {
  let el: HTMLElement | null = node.parentElement;
  while (el) {
    const oy = getComputedStyle(el).overflowY;
    if (oy === "auto" || oy === "scroll") return el;
    el = el.parentElement;
  }
  return null;
}

export function DocumentOutline({ editor }: { editor: Editor | null }) {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activePos, setActivePos] = useState<number | null>(null);
  const headingsRef = useRef<Heading[]>([]);

  useEffect(() => {
    headingsRef.current = headings;
  }, [headings]);

  // Re-derive the outline whenever the document changes.
  useEffect(() => {
    if (!editor) return;
    const update = () => setHeadings(collectHeadings(editor));
    editor.on("update", update);
    editor.on("create", update);
    update();
    return () => {
      editor.off("update", update);
      editor.off("create", update);
    };
  }, [editor]);

  // Highlight the heading the reader has scrolled past most recently.
  useEffect(() => {
    if (!editor) return;
    const scroller = getScrollParent(editor.view.dom);
    if (!scroller) return;
    const onScroll = () => {
      let current: number | null = null;
      for (const h of headingsRef.current) {
        const dom = editor.view.nodeDOM(h.pos);
        if (!(dom instanceof HTMLElement)) continue;
        if (dom.getBoundingClientRect().top - ACTIVE_OFFSET <= 0) current = h.pos;
        else break;
      }
      setActivePos(current);
    };
    scroller.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => scroller.removeEventListener("scroll", onScroll);
  }, [editor]);

  if (!editor || headings.length < 2) return null;

  const jump = (pos: number) => {
    const dom = editor.view.nodeDOM(pos);
    if (dom instanceof HTMLElement) {
      dom.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    setActivePos(pos);
  };

  return (
    <aside className="hidden xl:flex flex-col w-56 shrink-0 border-r border-border bg-background/40 overflow-y-auto">
      <div className="px-5 pt-10 pb-3 text-[10px] uppercase tracking-[0.18em] text-muted font-semibold">
        On this page
      </div>
      <nav className="px-2 pb-10">
        {headings.map((h) => {
          const active = h.pos === activePos;
          return (
            <button
              key={h.pos}
              type="button"
              onClick={() => jump(h.pos)}
              style={{ paddingLeft: `${(h.level - 1) * 12 + 12}px` }}
              className={`w-full text-left pr-3 py-1.5 text-[12px] truncate border-l-2 transition-colors ${
                active
                  ? "border-violet text-foreground bg-violet/[0.06]"
                  : "border-transparent text-muted hover:text-foreground hover:border-border"
              }`}
              title={h.text || "Untitled section"}
            >
              {h.text || "Untitled section"}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
