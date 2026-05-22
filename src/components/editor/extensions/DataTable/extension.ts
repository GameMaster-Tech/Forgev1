/**
 * DataTable — TipTap node definition.
 *
 * A `dataTable` is a block-level atom that owns its entire structured
 * payload via the `data` attribute. The attribute is a JSON object of
 * shape `DataTableAttrs`; we serialise it to a `data-table` attribute
 * on the rendered `div` so HTML round-trips preserve the structure
 * (TipTap's collaboration extension goes through ProseMirror's JSON,
 * but the HTML path is still used by paste / copy / export).
 *
 * The visual layer is a React NodeView (`./view.tsx`); this file is
 * the schema, commands, and (de)serialisation.
 */

import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { DataTableView } from "./view";
import {
  emptyTable,
  normaliseAttrs,
  type DataTableAttrs,
} from "./types";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    dataTable: {
      /** Insert a fresh, empty database block at the current selection. */
      insertDataTable: () => ReturnType;
    };
  }
}

export interface DataTableOptions {
  HTMLAttributes: Record<string, unknown>;
}

export const DataTable = Node.create<DataTableOptions>({
  name: "dataTable",
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
        default: emptyTable() as DataTableAttrs,
        parseHTML: (el) => {
          const raw = el.getAttribute("data-table");
          if (!raw) return emptyTable();
          try {
            return normaliseAttrs(JSON.parse(raw));
          } catch {
            return emptyTable();
          }
        },
        renderHTML: (attrs) => ({
          "data-table": JSON.stringify(attrs.data ?? emptyTable()),
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-forge-node="data-table"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-forge-node": "data-table",
        class: "forge-data-table-root",
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DataTableView);
  },

  addCommands() {
    return {
      insertDataTable:
        () =>
        ({ chain }) => {
          return chain()
            .focus()
            .insertContent({
              type: this.name,
              attrs: { data: emptyTable() },
            })
            .run();
        },
    };
  },
});
