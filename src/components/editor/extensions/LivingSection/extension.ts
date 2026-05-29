/**
 * LivingSection — TipTap node definition.
 *
 * A block-level atom whose body is *derived* from other content by a
 * plain-language rule and re-synthesises when its sources change. The
 * entire reactive payload lives in a single `data` attribute (JSON), so
 * it round-trips through the HTML autosave/collab path like DataTable.
 *
 * The visual + reactive layer is a React NodeView (`./view.tsx`); this
 * file is the schema, command, and (de)serialisation only.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { LivingSectionView } from "./view";
import type { ReactiveStatus } from "@/lib/reactive/types";

export interface LivingSectionData {
  id: string;
  /** Plain-language derivation rule, e.g. "key takeaways". */
  rule: string;
  /** Last derived content (sanitised HTML fragment). */
  value: string;
  status: ReactiveStatus;
  /** Hash of resolved source text at the last successful compute. */
  sourceHash: string;
  /** ms epoch of last successful compute. */
  computedAt: number | null;
}

function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ls_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  }
}

export function emptyData(): LivingSectionData {
  return {
    id: makeId(),
    rule: "",
    value: "",
    status: "empty",
    sourceHash: "",
    computedAt: null,
  };
}

export function normaliseData(raw: unknown): LivingSectionData {
  const d = (raw ?? {}) as Partial<LivingSectionData>;
  return {
    id: typeof d.id === "string" && d.id ? d.id : makeId(),
    rule: typeof d.rule === "string" ? d.rule : "",
    value: typeof d.value === "string" ? d.value : "",
    status: (d.status as ReactiveStatus) ?? "empty",
    sourceHash: typeof d.sourceHash === "string" ? d.sourceHash : "",
    computedAt: typeof d.computedAt === "number" ? d.computedAt : null,
  };
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    livingSection: {
      /** Insert a fresh, empty Living Section at the current selection. */
      insertLivingSection: () => ReturnType;
    };
  }
}

export interface LivingSectionOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const LivingSection = Node.create<LivingSectionOptions>({
  name: "livingSection",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      data: {
        default: emptyData(),
        parseHTML: (el) => {
          const raw = el.getAttribute("data-living-section");
          if (!raw) return emptyData();
          try {
            return normaliseData(JSON.parse(raw));
          } catch {
            return emptyData();
          }
        },
        renderHTML: (attrs) => ({
          "data-living-section": JSON.stringify(attrs.data ?? emptyData()),
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-forge-node="living-section"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-forge-node": "living-section",
        class: "forge-living-section-root",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(LivingSectionView);
  },

  addCommands() {
    return {
      insertLivingSection:
        () =>
        ({ chain }) =>
          chain()
            .focus()
            .insertContent({ type: this.name, attrs: { data: emptyData() } })
            .run(),
    };
  },
});
