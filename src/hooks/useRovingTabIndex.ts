"use client";

/**
 * useRovingTabIndex — implements the WAI-ARIA roving-tabindex pattern
 * for any 2D or 1D grid of focusable cells.
 *
 * Why this exists
 * ───────────────
 *   The Forge a11y baseline (TASK 13) gave us `useFocusTrap` for modals
 *   but did not implement roving tabindex anywhere. Without it, a grid
 *   with 42 cells (month view) demands 42 tab stops — terrible for
 *   keyboard users. With roving tabindex, the grid is a single tab
 *   stop; arrow keys move focus *within* the grid.
 *
 *   • Tab into the grid → lands on the active cell (last-focused or
 *     the first).
 *   • Arrow keys move focus between cells.
 *   • Enter / Space activates the cell.
 *   • Home / End jump to row start / end.
 *   • PageUp / PageDown jump to grid start / end.
 *   • Shift+Tab exits the grid.
 *
 * Headless. Returns a `getCellProps(row, col)` helper the consumer
 * spreads onto each cell button. The hook does not render anything.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface RovingGridOptions {
  /** Total rows in the grid. */
  rows: number;
  /** Total columns in the grid. */
  cols: number;
  /**
   * Called when the user activates a cell (Enter or Space). The
   * consumer wires this to the same click handler.
   */
  onActivate?: (row: number, col: number) => void;
  /**
   * If true, arrow keys wrap around at the edges (next-row on
   * right-arrow at end-of-row). Default false.
   */
  wrap?: boolean;
  /**
   * Disable the hook (e.g. while a modal is open over the grid).
   */
  disabled?: boolean;
  /**
   * Initial focused cell. Default {row: 0, col: 0}.
   */
  initialFocus?: { row: number; col: number };
}

export interface RovingCellProps {
  /** -1 or 0 — only the active cell has 0. */
  tabIndex: number;
  /** ARIA selected-ness for sr feedback. */
  "aria-selected"?: boolean;
  /** Ref the consumer must spread on the cell element. */
  ref: (el: HTMLElement | null) => void;
  /** Click → also moves the roving focus to this cell. */
  onClick: () => void;
  /** Keydown handler the consumer spreads. */
  onKeyDown: (e: React.KeyboardEvent) => void;
  /** Stable data-row/data-col attributes for tests + querying. */
  "data-row": number;
  "data-col": number;
}

export function useRovingTabIndex(opts: RovingGridOptions) {
  const { rows, cols, onActivate, wrap = false, disabled = false } = opts;
  const [active, setActive] = useState<{ row: number; col: number }>(
    () => opts.initialFocus ?? { row: 0, col: 0 },
  );
  const cellsRef = useRef<Map<string, HTMLElement>>(new Map());

  // Clamp active cell when the grid shrinks underneath us. This is a
  // legitimate "sync state to props" case; the lint rule's "prefer
  // useSyncExternalStore" suggestion doesn't apply here.
  useEffect(() => {
    if (active.row >= rows || active.col >= cols) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActive({
        row: Math.max(0, Math.min(rows - 1, active.row)),
        col: Math.max(0, Math.min(cols - 1, active.col)),
      });
    }
  }, [rows, cols, active.row, active.col]);

  const focusCell = useCallback((row: number, col: number) => {
    const key = `${row}:${col}`;
    const el = cellsRef.current.get(key);
    if (el) {
      el.focus({ preventScroll: false });
    }
  }, []);

  const setRef = useCallback((row: number, col: number) => (el: HTMLElement | null) => {
    const key = `${row}:${col}`;
    if (el) cellsRef.current.set(key, el);
    else cellsRef.current.delete(key);
  }, []);

  const move = useCallback(
    (next: { row: number; col: number }) => {
      const clamped = wrap
        ? wrapPosition(next, rows, cols)
        : clampPosition(next, rows, cols);
      setActive(clamped);
      // Defer focus to next tick so React commits the tabIndex change first.
      requestAnimationFrame(() => focusCell(clamped.row, clamped.col));
    },
    [rows, cols, wrap, focusCell],
  );

  const handleKeyDown = useCallback(
    (row: number, col: number, e: React.KeyboardEvent) => {
      if (disabled) return;
      switch (e.key) {
        case "ArrowRight":
          e.preventDefault();
          move({ row, col: col + 1 });
          break;
        case "ArrowLeft":
          e.preventDefault();
          move({ row, col: col - 1 });
          break;
        case "ArrowDown":
          e.preventDefault();
          move({ row: row + 1, col });
          break;
        case "ArrowUp":
          e.preventDefault();
          move({ row: row - 1, col });
          break;
        case "Home":
          e.preventDefault();
          move({ row, col: 0 });
          break;
        case "End":
          e.preventDefault();
          move({ row, col: cols - 1 });
          break;
        case "PageUp":
          e.preventDefault();
          move({ row: 0, col });
          break;
        case "PageDown":
          e.preventDefault();
          move({ row: rows - 1, col });
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          onActivate?.(row, col);
          break;
      }
    },
    [disabled, rows, cols, onActivate, move],
  );

  const getCellProps = useCallback(
    (row: number, col: number): RovingCellProps => ({
      tabIndex: row === active.row && col === active.col ? 0 : -1,
      "aria-selected": row === active.row && col === active.col,
      ref: setRef(row, col),
      "data-row": row,
      "data-col": col,
      onClick: () => {
        setActive({ row, col });
        onActivate?.(row, col);
      },
      onKeyDown: (e) => handleKeyDown(row, col, e),
    }),
    [active.row, active.col, setRef, onActivate, handleKeyDown],
  );

  return { active, setActive, getCellProps, focusCell };
}

/* ───────────── helpers ───────────── */

function clampPosition(p: { row: number; col: number }, rows: number, cols: number) {
  return {
    row: Math.max(0, Math.min(rows - 1, p.row)),
    col: Math.max(0, Math.min(cols - 1, p.col)),
  };
}

function wrapPosition(p: { row: number; col: number }, rows: number, cols: number) {
  // Treat the grid as a torus.
  const r = ((p.row % rows) + rows) % rows;
  const c = ((p.col % cols) + cols) % cols;
  return { row: r, col: c };
}
