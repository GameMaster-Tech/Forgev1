import { Node, mergeAttributes, nodeInputRule } from "@tiptap/core";
import katex from "katex";

/**
 * Inline math node:  $ a^2 + b^2 = c^2 $
 * Block math node:   $$ \int_0^\infty e^{-x} dx = 1 $$
 *
 * Stored as a leaf node with a `latex` attribute. Rendered via KaTeX
 * into a non-editable HTML block. Clicking a math node selects it and
 * opens the MathEditor bubble (see ForgeEditor.tsx).
 */

export interface MathOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    inlineMath: {
      insertInlineMath: (latex: string) => ReturnType;
      updateInlineMath: (latex: string) => ReturnType;
    };
    blockMath: {
      insertBlockMath: (latex: string) => ReturnType;
      updateBlockMath: (latex: string) => ReturnType;
    };
  }
}

function renderKatex(latex: string, displayMode: boolean): string {
  const src = (latex || "").trim();
  if (!src) {
    return `<span class="forge-math-empty">${
      displayMode ? "Empty block math — click to edit" : "empty math"
    }</span>`;
  }
  try {
    return katex.renderToString(src, {
      displayMode,
      throwOnError: false,
      errorColor: "#e11d48",
      strict: "ignore",
      trust: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid LaTeX";
    return `<span class="katex-error">${msg}</span>`;
  }
}

export const InlineMath = Node.create<MathOptions>({
  name: "inlineMath",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  marks: "",

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) =>
          el.getAttribute("data-latex") ?? el.textContent ?? "",
        renderHTML: (attrs) => ({ "data-latex": attrs.latex }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'span[data-type="inline-math"]' },
      { tag: "span.forge-math-inline" },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const latex = (node.attrs.latex as string) ?? "";
    return [
      "span",
      mergeAttributes(
        {
          "data-type": "inline-math",
          class: "forge-math-inline",
        },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      `$${latex}$`,
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("span");
      dom.setAttribute("data-type", "inline-math");
      dom.className = "forge-math-inline";
      dom.contentEditable = "false";
      const render = () => {
        dom.innerHTML = renderKatex(node.attrs.latex, false);
      };
      render();
      dom.addEventListener("click", (e) => {
        e.preventDefault();
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos != null) {
          editor.chain().focus().setNodeSelection(pos).run();
        }
      });
      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "inlineMath") return false;
          dom.innerHTML = renderKatex(updatedNode.attrs.latex, false);
          return true;
        },
      };
    };
  },

  addCommands() {
    return {
      insertInlineMath:
        (latex: string) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { latex },
          }),
      updateInlineMath:
        (latex: string) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { latex }),
    };
  },

  addInputRules() {
    return [
      // $x^2$ → inline math (trigger on closing $)
      nodeInputRule({
        find: /\$([^$\n]+)\$$/,
        type: this.type,
        getAttributes: (match) => ({ latex: match[1] }),
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-m": () => {
        const latex = window.prompt("Inline LaTeX:", "");
        if (!latex) return false;
        return this.editor
          .chain()
          .focus()
          .insertInlineMath(latex.trim())
          .run();
      },
    };
  },
});

export const BlockMath = Node.create<MathOptions>({
  name: "blockMath",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  defining: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      latex: {
        default: "",
        parseHTML: (el) =>
          el.getAttribute("data-latex") ?? el.textContent ?? "",
        renderHTML: (attrs) => ({ "data-latex": attrs.latex }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: 'div[data-type="block-math"]' },
      { tag: "div.forge-math-block" },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const latex = (node.attrs.latex as string) ?? "";
    return [
      "div",
      mergeAttributes(
        {
          "data-type": "block-math",
          class: "forge-math-block",
        },
        this.options.HTMLAttributes,
        HTMLAttributes
      ),
      `$$${latex}$$`,
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.setAttribute("data-type", "block-math");
      dom.className = "forge-math-block";
      dom.contentEditable = "false";
      const render = () => {
        dom.innerHTML = renderKatex(node.attrs.latex, true);
      };
      render();
      dom.addEventListener("click", (e) => {
        e.preventDefault();
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos != null) {
          editor.chain().focus().setNodeSelection(pos).run();
        }
      });
      return {
        dom,
        update: (updatedNode) => {
          if (updatedNode.type.name !== "blockMath") return false;
          dom.innerHTML = renderKatex(updatedNode.attrs.latex, true);
          return true;
        },
      };
    };
  },

  addCommands() {
    return {
      insertBlockMath:
        (latex: string) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { latex },
          }),
      updateBlockMath:
        (latex: string) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { latex }),
    };
  },

  addInputRules() {
    return [
      // $$\int x dx$$ → block math
      nodeInputRule({
        find: /^\$\$([^$]+)\$\$$/,
        type: this.type,
        getAttributes: (match) => ({ latex: match[1] }),
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Shift-b": () => {
        const latex = window.prompt("Block LaTeX:", "");
        if (!latex) return false;
        return this.editor
          .chain()
          .focus()
          .insertBlockMath(latex.trim())
          .run();
      },
    };
  },
});
