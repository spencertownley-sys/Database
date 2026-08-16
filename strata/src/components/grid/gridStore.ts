'use client';

/**
 * Grid interaction state: the selection rectangle, the edit buffer, and the
 * local undo stack.
 *
 * **This is Zustand and not React state, and that is not a style preference.**
 * The default failure mode of a spreadsheet grid is putting selection in React
 * context: every arrow key then re-renders every mounted cell, and at 10k rows
 * the grid drops to single-digit frames per second. With the selection in an
 * external store, a cell subscribes to a *slice* — `isSelected` for its own
 * coordinate — so an arrow key re-renders the two cells whose selected state
 * actually changed.
 *
 * The rule cells must follow: never subscribe to the whole store, and never
 * read `selection` directly from a cell. Use `useCellSelectionState(row, col)`,
 * which returns a primitive-comparable slice.
 */

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

export interface CellCoord {
  row: number;
  col: number;
}

export interface SelectionRect {
  /** Where the selection started — the cell that stays put while extending. */
  anchor: CellCoord;
  /** Where it currently ends — the cell that moves with Shift+Arrow. */
  focus: CellCoord;
}

export interface EditState {
  row: number;
  col: number;
  /** Seed text when editing began by typing rather than by F2/double-click. */
  initialValue?: string;
  /** True when typing replaced the value rather than entering it for edit. */
  replace: boolean;
}

/** One entry on the local stack, mapping to a committed change set. */
export interface UndoEntry {
  /**
   * One user gesture can commit several change sets (a paste of distinct
   * values is one set per distinct patch). Undo reverses them together, in
   * reverse commit order — a paste that undoes only its last slice is worse
   * than no undo.
   */
  changeSetIds: string[];
  label: string;
  itemCount: number;
  at: number;
}

export const UNDO_STACK_LIMIT = 50;

interface GridState {
  selection: SelectionRect | null;
  editing: EditState | null;
  /** Rows currently mid-write, so the cell can render a pending state. */
  pendingRows: ReadonlySet<string>;
  /** Per-cell error from a failed optimistic write, keyed `rowId:fieldKey`. */
  cellErrors: Readonly<Record<string, string>>;
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  /** True while a fill-handle drag is in progress. */
  fillTarget: CellCoord | null;
  /** True while a click-drag selection is in progress. */
  isDragging: boolean;

  setSelection: (rect: SelectionRect | null) => void;
  selectCell: (coord: CellCoord) => void;
  extendTo: (coord: CellCoord) => void;
  selectAll: (rowCount: number, colCount: number) => void;
  moveFocus: (
    delta: { row: number; col: number },
    bounds: { rows: number; cols: number },
    extend: boolean,
  ) => void;
  moveToEdge: (
    direction: 'up' | 'down' | 'left' | 'right',
    bounds: { rows: number; cols: number },
    extend: boolean,
  ) => void;

  beginEdit: (edit: EditState) => void;
  endEdit: () => void;

  setDragging: (dragging: boolean) => void;
  setFillTarget: (coord: CellCoord | null) => void;

  markPending: (rowIds: readonly string[]) => void;
  clearPending: (rowIds: readonly string[]) => void;
  setCellError: (rowId: string, fieldKey: string, message: string | null) => void;
  clearCellErrors: () => void;

  pushUndo: (entry: UndoEntry) => void;
  popUndo: () => UndoEntry | null;
  pushRedo: (entry: UndoEntry) => void;
  popRedo: () => UndoEntry | null;
  clearHistory: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export const useGridStore = create<GridState>()(
  subscribeWithSelector((set, get) => ({
    selection: null,
    editing: null,
    pendingRows: new Set<string>(),
    cellErrors: {},
    undoStack: [],
    redoStack: [],
    fillTarget: null,
    isDragging: false,

    setSelection: (selection) => set({ selection }),

    selectCell: (coord) => set({ selection: { anchor: coord, focus: coord }, editing: null }),

    extendTo: (coord) =>
      set((state) =>
        state.selection ? { selection: { anchor: state.selection.anchor, focus: coord } } : {},
      ),

    selectAll: (rowCount, colCount) =>
      set({
        selection: {
          anchor: { row: 0, col: 0 },
          focus: { row: Math.max(rowCount - 1, 0), col: Math.max(colCount - 1, 0) },
        },
        editing: null,
      }),

    moveFocus: (delta, bounds, extend) =>
      set((state) => {
        const current = state.selection;
        if (!current) {
          return { selection: { anchor: { row: 0, col: 0 }, focus: { row: 0, col: 0 } } };
        }
        const next: CellCoord = {
          row: clamp(current.focus.row + delta.row, 0, Math.max(bounds.rows - 1, 0)),
          col: clamp(current.focus.col + delta.col, 0, Math.max(bounds.cols - 1, 0)),
        };
        return {
          selection: extend
            ? { anchor: current.anchor, focus: next }
            : { anchor: next, focus: next },
          editing: null,
        };
      }),

    moveToEdge: (direction, bounds, extend) =>
      set((state) => {
        const current = state.selection;
        if (!current) return {};
        const next: CellCoord = { ...current.focus };
        if (direction === 'up') next.row = 0;
        if (direction === 'down') next.row = Math.max(bounds.rows - 1, 0);
        if (direction === 'left') next.col = 0;
        if (direction === 'right') next.col = Math.max(bounds.cols - 1, 0);
        return {
          selection: extend
            ? { anchor: current.anchor, focus: next }
            : { anchor: next, focus: next },
          editing: null,
        };
      }),

    beginEdit: (editing) => set({ editing }),
    endEdit: () => set({ editing: null }),

    setDragging: (isDragging) => set({ isDragging }),
    setFillTarget: (fillTarget) => set({ fillTarget }),

    markPending: (rowIds) =>
      set((state) => {
        const next = new Set(state.pendingRows);
        for (const id of rowIds) next.add(id);
        return { pendingRows: next };
      }),

    clearPending: (rowIds) =>
      set((state) => {
        const next = new Set(state.pendingRows);
        for (const id of rowIds) next.delete(id);
        return { pendingRows: next };
      }),

    setCellError: (rowId, fieldKey, message) =>
      set((state) => {
        const key = `${rowId}:${fieldKey}`;
        const next = { ...state.cellErrors };
        if (message === null) delete next[key];
        else next[key] = message;
        return { cellErrors: next };
      }),

    clearCellErrors: () => set({ cellErrors: {} }),

    pushUndo: (entry) =>
      set((state) => ({
        // A new edit invalidates the redo branch, exactly as a text editor does.
        undoStack: [...state.undoStack, entry].slice(-UNDO_STACK_LIMIT),
        redoStack: [],
      })),

    popUndo: () => {
      const stack = get().undoStack;
      const entry = stack[stack.length - 1];
      if (!entry) return null;
      set({ undoStack: stack.slice(0, -1) });
      return entry;
    },

    pushRedo: (entry) =>
      set((state) => ({ redoStack: [...state.redoStack, entry].slice(-UNDO_STACK_LIMIT) })),

    popRedo: () => {
      const stack = get().redoStack;
      const entry = stack[stack.length - 1];
      if (!entry) return null;
      set({ redoStack: stack.slice(0, -1) });
      return entry;
    },

    clearHistory: () => set({ undoStack: [], redoStack: [] }),
  })),
);

// ---------------------------------------------------------------------------
// selection geometry
// ---------------------------------------------------------------------------

export interface NormalisedRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Anchor and focus in either order → an inclusive top-left/bottom-right box. */
export function normaliseRect(rect: SelectionRect): NormalisedRect {
  return {
    top: Math.min(rect.anchor.row, rect.focus.row),
    bottom: Math.max(rect.anchor.row, rect.focus.row),
    left: Math.min(rect.anchor.col, rect.focus.col),
    right: Math.max(rect.anchor.col, rect.focus.col),
  };
}

export function rectContains(rect: NormalisedRect, row: number, col: number): boolean {
  return row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right;
}

export function rectSize(rect: NormalisedRect): { rows: number; cols: number; cells: number } {
  const rows = rect.bottom - rect.top + 1;
  const cols = rect.right - rect.left + 1;
  return { rows, cols, cells: rows * cols };
}

// ---------------------------------------------------------------------------
// cell-level subscriptions
// ---------------------------------------------------------------------------

/**
 * The slice a cell subscribes to.
 *
 * Returns a packed integer rather than an object so Zustand's default
 * `Object.is` comparison is enough — returning `{isSelected, isFocused}` would
 * allocate a new object on every store change and re-render every cell, which
 * is the exact bug this architecture exists to avoid.
 */
export const enum CellFlags {
  None = 0,
  Selected = 1,
  Focused = 2,
  Editing = 4,
  InFillPreview = 8,
}

export function useCellFlags(row: number, col: number): number {
  return useGridStore((state) => {
    let flags = CellFlags.None;
    const selection = state.selection;

    if (selection) {
      const rect = normaliseRect(selection);
      if (rectContains(rect, row, col)) flags |= CellFlags.Selected;
      if (selection.focus.row === row && selection.focus.col === col) flags |= CellFlags.Focused;

      const fill = state.fillTarget;
      if (fill) {
        const fillRect = normaliseRect({ anchor: selection.focus, focus: fill });
        if (rectContains(fillRect, row, col)) flags |= CellFlags.InFillPreview;
      }
    }

    const editing = state.editing;
    if (editing && editing.row === row && editing.col === col) flags |= CellFlags.Editing;

    return flags;
  });
}

/**
 * Selection readout ("42 cells, 12 rows").
 *
 * `useShallow` is required, not decorative: Zustand v5 compares with
 * `Object.is`, so a selector returning a fresh object re-renders its subscriber
 * on *every* store change — including each keystroke in an unrelated cell.
 */
export function useSelectionSummary(): { cells: number; rows: number; cols: number } | null {
  return useGridStore(
    useShallow((state) => {
      if (!state.selection) return null;
      const size = rectSize(normaliseRect(state.selection));
      return size.cells <= 1 ? null : size;
    }),
  );
}
