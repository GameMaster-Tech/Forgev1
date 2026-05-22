/**
 * DataTable — type contract for the inline "Notion-style" database
 * block in the Forge editor.
 *
 * Layout in the document:
 *   Node `dataTable` with a single `data` attribute (JSON). The attr
 *   carries the *entire* table shape — columns + rows — so the node
 *   itself is a single atomic ProseMirror unit. Inline editing
 *   updates the attr via `updateAttributes`; ProseMirror handles
 *   history, collab via Yjs, etc. for free.
 *
 * Cell value union:
 *   The column's `type` dictates the runtime shape of every cell in
 *   that column. We model cells as a tagged union so the React
 *   NodeView can pick the right input control without losing type
 *   safety. Empty cells render as `null`.
 */

export type ColumnType =
  | "text"
  | "number"
  | "date"
  | "checkbox"
  | "select";

export interface SelectOption {
  id: string;
  label: string;
  /** Optional CSS color token name ("violet" | "green" | …). */
  color?: string;
}

export interface DataTableColumn {
  id: string;
  name: string;
  type: ColumnType;
  /** Pixel width hint. The React view treats this as a starting value. */
  width?: number;
  /** When type === "select", the allowed options. */
  options?: SelectOption[];
}

export type DataTableCellValue =
  | { type: "text"; value: string }
  | { type: "number"; value: number | null }
  | { type: "date"; value: string | null } // ISO yyyy-mm-dd
  | { type: "checkbox"; value: boolean }
  | { type: "select"; value: string | null } // option id
  | null;

export interface DataTableRow {
  id: string;
  /** Keyed by column id. Absent keys mean "empty cell". */
  cells: Record<string, DataTableCellValue>;
}

export interface DataTableAttrs {
  /** Optional title shown above the table. */
  title: string;
  columns: DataTableColumn[];
  rows: DataTableRow[];
  /** Schema rev — bump if the attrs shape changes. */
  rev: number;
}

export const DATA_TABLE_REV = 1;

/* ───────────── helpers ───────────── */

export function makeId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function defaultCellFor(type: ColumnType): DataTableCellValue {
  switch (type) {
    case "text":
      return { type: "text", value: "" };
    case "number":
      return { type: "number", value: null };
    case "date":
      return { type: "date", value: null };
    case "checkbox":
      return { type: "checkbox", value: false };
    case "select":
      return { type: "select", value: null };
  }
}

export function emptyTable(): DataTableAttrs {
  const c1: DataTableColumn = { id: makeId("c"), name: "Name", type: "text", width: 260 };
  const c2: DataTableColumn = { id: makeId("c"), name: "Status", type: "select", width: 140, options: [
    { id: "todo", label: "Todo", color: "muted" },
    { id: "doing", label: "Doing", color: "violet" },
    { id: "done", label: "Done", color: "green" },
  ] };
  const c3: DataTableColumn = { id: makeId("c"), name: "Due", type: "date", width: 140 };

  const rowOf = (name: string, status: string, due: string | null): DataTableRow => ({
    id: makeId("r"),
    cells: {
      [c1.id]: { type: "text", value: name },
      [c2.id]: { type: "select", value: status },
      [c3.id]: { type: "date", value: due },
    },
  });

  return {
    title: "Table",
    rev: DATA_TABLE_REV,
    columns: [c1, c2, c3],
    rows: [
      rowOf("", "todo", null),
      rowOf("", "todo", null),
      rowOf("", "todo", null),
    ],
  };
}

/** Defensive cast for attrs coming back from a round-trip through HTML. */
export function normaliseAttrs(raw: unknown): DataTableAttrs {
  if (!raw || typeof raw !== "object") return emptyTable();
  const obj = raw as Partial<DataTableAttrs>;
  if (!Array.isArray(obj.columns) || !Array.isArray(obj.rows)) return emptyTable();
  return {
    title: typeof obj.title === "string" ? obj.title : "Table",
    columns: obj.columns,
    rows: obj.rows,
    rev: typeof obj.rev === "number" ? obj.rev : DATA_TABLE_REV,
  };
}
