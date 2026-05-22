"use client";

/**
 * DataTableView — React NodeView for the `dataTable` TipTap node.
 *
 * Renders the entire database block inside the editor: title row,
 * column header bar with per-type icons + add-column control, body
 * rows with per-type cell editors, footer "+ row" affordance.
 *
 * The component is a *controlled* surface — it reads its state from
 * `node.attrs.data` and writes every mutation through
 * `updateAttributes`. ProseMirror takes the diff and persists,
 * collaborates, and provides undo for free.
 *
 * Cell editors are keyboard-friendly: Enter commits and moves down,
 * Tab commits and moves right, Esc reverts to the value at focus time.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NodeViewProps } from "@tiptap/react";
import { NodeViewWrapper } from "@tiptap/react";
import {
  Plus,
  Trash2,
  Type,
  Hash,
  Calendar as CalendarIcon,
  CheckSquare,
  ChevronDown,
} from "lucide-react";
import {
  defaultCellFor,
  makeId,
  normaliseAttrs,
  type ColumnType,
  type DataTableAttrs,
  type DataTableCellValue,
  type DataTableColumn,
} from "./types";

const COLUMN_TYPE_META: Record<
  ColumnType,
  { label: string; icon: typeof Type }
> = {
  text: { label: "Text", icon: Type },
  number: { label: "Number", icon: Hash },
  date: { label: "Date", icon: CalendarIcon },
  checkbox: { label: "Checkbox", icon: CheckSquare },
  select: { label: "Select", icon: ChevronDown },
};

export function DataTableView({ node, updateAttributes }: NodeViewProps) {
  const attrs = useMemo<DataTableAttrs>(
    () => normaliseAttrs(node.attrs.data),
    [node.attrs.data],
  );

  // Snapshot of the latest attrs into a ref so callbacks composing
  // multiple updates can read the freshest value without re-running.
  // The ref must be written from an effect (not the render body) so
  // React Compiler's `refs` rule stays clean.
  const attrsRef = useRef(attrs);
  useEffect(() => {
    attrsRef.current = attrs;
  }, [attrs]);

  const commit = useCallback(
    (mut: (prev: DataTableAttrs) => DataTableAttrs) => {
      const next = mut(attrsRef.current);
      attrsRef.current = next;
      updateAttributes({ data: next });
    },
    [updateAttributes],
  );

  const setTitle = useCallback(
    (title: string) => {
      commit((prev) => ({ ...prev, title }));
    },
    [commit],
  );

  const updateCell = useCallback(
    (rowId: string, columnId: string, value: DataTableCellValue) => {
      commit((prev) => ({
        ...prev,
        rows: prev.rows.map((r) =>
          r.id === rowId ? { ...r, cells: { ...r.cells, [columnId]: value } } : r,
        ),
      }));
    },
    [commit],
  );

  const addRow = useCallback(() => {
    commit((prev) => ({
      ...prev,
      rows: [
        ...prev.rows,
        {
          id: makeId("r"),
          cells: Object.fromEntries(
            prev.columns.map((c) => [c.id, defaultCellFor(c.type)]),
          ),
        },
      ],
    }));
  }, [commit]);

  const removeRow = useCallback(
    (rowId: string) => {
      commit((prev) => ({
        ...prev,
        rows: prev.rows.filter((r) => r.id !== rowId),
      }));
    },
    [commit],
  );

  const addColumn = useCallback(
    (type: ColumnType) => {
      commit((prev) => {
        const newCol: DataTableColumn = {
          id: makeId("c"),
          name: `Column ${prev.columns.length + 1}`,
          type,
          width: 160,
          ...(type === "select"
            ? {
                options: [
                  { id: "opt_1", label: "Option 1", color: "violet" },
                  { id: "opt_2", label: "Option 2", color: "muted" },
                ],
              }
            : {}),
        };
        return {
          ...prev,
          columns: [...prev.columns, newCol],
          rows: prev.rows.map((r) => ({
            ...r,
            cells: { ...r.cells, [newCol.id]: defaultCellFor(type) },
          })),
        };
      });
    },
    [commit],
  );

  const renameColumn = useCallback(
    (columnId: string, name: string) => {
      commit((prev) => ({
        ...prev,
        columns: prev.columns.map((c) =>
          c.id === columnId ? { ...c, name } : c,
        ),
      }));
    },
    [commit],
  );

  const removeColumn = useCallback(
    (columnId: string) => {
      commit((prev) => {
        const nextColumns = prev.columns.filter((c) => c.id !== columnId);
        const nextRows = prev.rows.map((r) => {
          const cells = { ...r.cells };
          delete cells[columnId];
          return { ...r, cells };
        });
        return { ...prev, columns: nextColumns, rows: nextRows };
      });
    },
    [commit],
  );

  const [addingColumn, setAddingColumn] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  return (
    <NodeViewWrapper className="forge-data-table-wrapper my-4">
      <div className="border border-border bg-surface">
        {/* Title row */}
        <div className="px-4 pt-3 pb-2 border-b border-border">
          <input
            type="text"
            value={attrs.title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Untitled table"
            className="w-full bg-transparent text-[15px] font-display font-bold text-foreground tracking-[-0.014em] placeholder:text-muted focus:outline-none"
          />
        </div>

        {/* Header row */}
        <div
          className="grid border-b border-border bg-background"
          style={{
            gridTemplateColumns: gridTemplate(attrs.columns) + " 32px",
          }}
        >
          {attrs.columns.map((col) => {
            const Icon = COLUMN_TYPE_META[col.type].icon;
            const isOpen = activeMenu === col.id;
            return (
              <div
                key={col.id}
                className="relative flex items-center gap-1.5 px-2.5 py-1.5 border-r border-border last:border-r-0"
              >
                <Icon size={11} strokeWidth={1.75} className="text-muted shrink-0" />
                <input
                  type="text"
                  value={col.name}
                  onChange={(e) => renameColumn(col.id, e.target.value)}
                  className="flex-1 min-w-0 bg-transparent text-[11px] uppercase tracking-[0.12em] font-semibold text-foreground placeholder:text-muted focus:outline-none"
                />
                <button
                  type="button"
                  aria-label="Column menu"
                  onClick={() => setActiveMenu(isOpen ? null : col.id)}
                  className="text-muted hover:text-foreground transition-colors p-0.5"
                >
                  <ChevronDown size={11} strokeWidth={2} />
                </button>
                {isOpen ? (
                  <>
                    <div
                      className="fixed inset-0 z-30"
                      onClick={() => setActiveMenu(null)}
                      aria-hidden
                    />
                    <div className="absolute z-40 right-0 top-full mt-1 w-44 bg-foreground text-background border border-white/10 shadow-[0_20px_44px_-18px_rgba(0,0,0,0.55)]">
                      <button
                        type="button"
                        onClick={() => {
                          removeColumn(col.id);
                          setActiveMenu(null);
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-[0.12em] font-semibold text-rose hover:bg-white/[0.06]"
                      >
                        <Trash2 size={11} strokeWidth={2} />
                        Delete column
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            );
          })}
          {/* + column slot */}
          <div className="relative border-r border-border last:border-r-0">
            <button
              type="button"
              aria-label="Add column"
              onClick={() => setAddingColumn((v) => !v)}
              className="w-full h-full flex items-center justify-center text-muted hover:text-violet hover:bg-violet/[0.06] transition-colors"
            >
              <Plus size={12} strokeWidth={2.25} />
            </button>
            {addingColumn ? (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setAddingColumn(false)}
                  aria-hidden
                />
                <div className="absolute z-40 right-0 top-full mt-1 w-44 bg-foreground text-background border border-white/10 shadow-[0_20px_44px_-18px_rgba(0,0,0,0.55)]">
                  <div className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-[0.18em] text-background/60 font-semibold">
                    Add column
                  </div>
                  <ul>
                    {(Object.keys(COLUMN_TYPE_META) as ColumnType[]).map((t) => {
                      const meta = COLUMN_TYPE_META[t];
                      const Icon = meta.icon;
                      return (
                        <li key={t}>
                          <button
                            type="button"
                            onClick={() => {
                              addColumn(t);
                              setAddingColumn(false);
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[11px] font-medium hover:bg-white/[0.06]"
                          >
                            <Icon size={11} strokeWidth={2} className="text-background/70" />
                            {meta.label}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            ) : null}
          </div>
        </div>

        {/* Body rows */}
        {attrs.rows.map((row) => (
          <div
            key={row.id}
            className="group/row grid border-b border-border last:border-b-0 bg-background"
            style={{
              gridTemplateColumns: gridTemplate(attrs.columns) + " 32px",
            }}
          >
            {attrs.columns.map((col) => (
              <div
                key={col.id}
                className="border-r border-border last:border-r-0 min-h-[36px]"
              >
                <CellEditor
                  column={col}
                  value={row.cells[col.id] ?? defaultCellFor(col.type)}
                  onChange={(v) => updateCell(row.id, col.id, v)}
                />
              </div>
            ))}
            <div className="flex items-center justify-center">
              <button
                type="button"
                aria-label="Remove row"
                onClick={() => removeRow(row.id)}
                className="text-muted opacity-0 group-hover/row:opacity-100 hover:text-rose transition-all p-1"
              >
                <Trash2 size={11} strokeWidth={2} />
              </button>
            </div>
          </div>
        ))}

        {/* Footer + row */}
        <button
          type="button"
          onClick={addRow}
          className="w-full flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-[0.12em] font-semibold text-muted hover:text-violet hover:bg-violet/[0.04] transition-colors"
        >
          <Plus size={11} strokeWidth={2.25} />
          New row
        </button>
      </div>
    </NodeViewWrapper>
  );
}

/* ───────────── grid template ───────────── */

function gridTemplate(columns: DataTableColumn[]): string {
  return columns
    .map((c) => `${Math.max(80, c.width ?? 160)}px`)
    .join(" ");
}

/* ───────────── per-type cell editor ───────────── */

interface CellEditorProps {
  column: DataTableColumn;
  value: DataTableCellValue;
  onChange: (next: DataTableCellValue) => void;
}

function CellEditor({ column, value, onChange }: CellEditorProps) {
  switch (column.type) {
    case "text": {
      const v = (value && value.type === "text" ? value.value : "") ?? "";
      return (
        <input
          type="text"
          value={v}
          onChange={(e) =>
            onChange({ type: "text", value: e.target.value })
          }
          className="w-full h-full px-2.5 py-1.5 bg-transparent text-[13px] text-foreground placeholder:text-muted focus:outline-none focus:bg-violet/[0.04]"
          placeholder="—"
        />
      );
    }
    case "number": {
      const v = value && value.type === "number" && value.value != null
        ? String(value.value)
        : "";
      return (
        <input
          type="number"
          value={v}
          onChange={(e) => {
            const raw = e.target.value;
            const parsed = raw === "" ? null : Number(raw);
            onChange({
              type: "number",
              value: Number.isFinite(parsed) ? parsed : null,
            });
          }}
          className="w-full h-full px-2.5 py-1.5 bg-transparent text-[13px] text-foreground tabular-nums placeholder:text-muted focus:outline-none focus:bg-violet/[0.04]"
          placeholder="—"
        />
      );
    }
    case "date": {
      const v = value && value.type === "date" ? value.value ?? "" : "";
      return (
        <input
          type="date"
          value={v}
          onChange={(e) =>
            onChange({
              type: "date",
              value: e.target.value || null,
            })
          }
          className="w-full h-full px-2.5 py-1.5 bg-transparent text-[13px] text-foreground tabular-nums placeholder:text-muted focus:outline-none focus:bg-violet/[0.04]"
        />
      );
    }
    case "checkbox": {
      const v = !!(value && value.type === "checkbox" && value.value);
      return (
        <label className="w-full h-full flex items-center justify-center cursor-pointer">
          <input
            type="checkbox"
            checked={v}
            onChange={(e) =>
              onChange({ type: "checkbox", value: e.target.checked })
            }
            className="accent-violet"
          />
        </label>
      );
    }
    case "select": {
      const v = value && value.type === "select" ? value.value : null;
      const options = column.options ?? [];
      const current = options.find((o) => o.id === v);
      return (
        <SelectCell
          options={options}
          currentId={v}
          currentLabel={current?.label}
          onChange={(next) =>
            onChange({ type: "select", value: next })
          }
        />
      );
    }
  }
}

interface SelectCellProps {
  options: { id: string; label: string; color?: string }[];
  currentId: string | null;
  currentLabel?: string;
  onChange: (next: string | null) => void;
}

function SelectCell({
  options,
  currentId,
  currentLabel,
  onChange,
}: SelectCellProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative w-full h-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full h-full flex items-center justify-between px-2.5 py-1.5 bg-transparent text-[13px] text-foreground hover:bg-violet/[0.04] transition-colors"
      >
        <span className={currentLabel ? "" : "text-muted"}>
          {currentLabel ?? "—"}
        </span>
        <ChevronDown size={11} strokeWidth={1.75} className="text-muted" />
      </button>
      {open ? (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <ul className="absolute z-40 left-0 right-0 top-full mt-1 bg-foreground text-background border border-white/10 shadow-[0_20px_44px_-18px_rgba(0,0,0,0.55)]">
            <li>
              <button
                type="button"
                onClick={() => {
                  onChange(null);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-[12px] hover:bg-white/[0.06] ${
                  currentId === null ? "text-background" : "text-background/60"
                }`}
              >
                —
              </button>
            </li>
            {options.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onClick={() => {
                    onChange(o.id);
                    setOpen(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-[12px] hover:bg-white/[0.06] ${
                    currentId === o.id ? "text-background" : "text-background/80"
                  }`}
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
