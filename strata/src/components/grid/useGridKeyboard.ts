'use client';

/**
 * The grid key map.
 *
 * Every binding here exists because a spreadsheet has it and the user's hands
 * already know it. Deviating "because it is a web app" is how the grid stops
 * feeling like Excel within thirty seconds of someone trying it.
 *
 *   Arrows                  move one cell
 *   Shift+Arrows            extend the selection
 *   Ctrl/Cmd+Arrows         jump to the edge
 *   Ctrl/Cmd+Shift+Arrows   extend to the edge
 *   Tab / Shift+Tab         next / previous cell, wrapping across rows
 *   Enter / Shift+Enter     down / up (and commits an open editor)
 *   Ctrl/Cmd+A              select all
 *   F2 / double-click       edit in place, caret at the end
 *   Typing a character      replace the value, caret after that character
 *   Esc                     cancel the editor, keeping the original value
 *   Delete / Backspace      clear the selected cells
 *   Ctrl/Cmd+C / V / X      copy / paste / cut
 *   Ctrl/Cmd+D              fill down
 *   Ctrl/Cmd+Z              undo   ·   Ctrl/Cmd+Shift+Z  redo
 */

import { useEffect } from 'react';
import { useGridStore } from './gridStore';

export interface GridKeyboardHandlers {
  bounds: { rows: number; cols: number };
  onEditStart: (opts: { replace: boolean; initialValue?: string }) => void;
  onEditCommit: (direction: 'down' | 'up' | 'right' | 'left' | 'none') => void;
  onEditCancel: () => void;
  onClear: () => void;
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
  onFillDown: () => void;
  onUndo: () => void;
  onRedo: () => void;
  enabled: boolean;
}

/** Characters that begin an edit. Excludes control keys and dead keys. */
function isPrintable(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  return event.key.length === 1;
}

export function useGridKeyboard(handlers: GridKeyboardHandlers): void {
  const {
    bounds,
    onEditStart,
    onEditCommit,
    onEditCancel,
    onClear,
    onCopy,
    onCut,
    onPaste,
    onFillDown,
    onUndo,
    onRedo,
    enabled,
  } = handlers;

  useEffect(() => {
    if (!enabled) return undefined;

    function handle(event: KeyboardEvent): void {
      const state = useGridStore.getState();
      const isEditing = state.editing !== null;
      const mod = event.metaKey || event.ctrlKey;

      // While an editor is open only the keys that end it are ours; everything
      // else belongs to the input, or typing "v" in a cell would paste.
      if (isEditing) {
        if (event.key === 'Escape') {
          event.preventDefault();
          onEditCancel();
        } else if (event.key === 'Enter') {
          event.preventDefault();
          onEditCommit(event.shiftKey ? 'up' : 'down');
        } else if (event.key === 'Tab') {
          event.preventDefault();
          onEditCommit(event.shiftKey ? 'left' : 'right');
        }
        return;
      }

      if (!state.selection) return;

      switch (event.key) {
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          event.preventDefault();
          const direction =
            event.key === 'ArrowUp'
              ? 'up'
              : event.key === 'ArrowDown'
                ? 'down'
                : event.key === 'ArrowLeft'
                  ? 'left'
                  : 'right';

          if (mod) {
            state.moveToEdge(direction, bounds, event.shiftKey);
            return;
          }
          const delta = {
            up: { row: -1, col: 0 },
            down: { row: 1, col: 0 },
            left: { row: 0, col: -1 },
            right: { row: 0, col: 1 },
          }[direction];
          state.moveFocus(delta, bounds, event.shiftKey);
          return;
        }

        case 'Tab': {
          event.preventDefault();
          // Tab wraps: at the last column it moves to the first column of the
          // next row, which is how a spreadsheet walks a form-shaped block.
          const { focus } = state.selection;
          const forward = !event.shiftKey;
          let col = focus.col + (forward ? 1 : -1);
          let row = focus.row;
          if (col >= bounds.cols) {
            col = 0;
            row = Math.min(row + 1, bounds.rows - 1);
          } else if (col < 0) {
            col = bounds.cols - 1;
            row = Math.max(row - 1, 0);
          }
          state.selectCell({ row, col });
          return;
        }

        case 'Enter': {
          event.preventDefault();
          if (event.altKey) {
            onEditStart({ replace: false });
            return;
          }
          state.moveFocus({ row: event.shiftKey ? -1 : 1, col: 0 }, bounds, false);
          return;
        }

        case 'F2':
          event.preventDefault();
          onEditStart({ replace: false });
          return;

        case 'Escape':
          event.preventDefault();
          state.setSelection(null);
          return;

        case 'Delete':
        case 'Backspace':
          event.preventDefault();
          onClear();
          return;

        case 'a':
        case 'A':
          if (mod) {
            event.preventDefault();
            state.selectAll(bounds.rows, bounds.cols);
          }
          return;

        case 'c':
        case 'C':
          if (mod) {
            event.preventDefault();
            onCopy();
          }
          return;

        case 'x':
        case 'X':
          if (mod) {
            event.preventDefault();
            onCut();
          }
          return;

        case 'v':
        case 'V':
          if (mod) {
            event.preventDefault();
            onPaste();
          }
          return;

        case 'd':
        case 'D':
          if (mod) {
            event.preventDefault();
            onFillDown();
          }
          return;

        case 'z':
        case 'Z':
          if (mod) {
            event.preventDefault();
            if (event.shiftKey) onRedo();
            else onUndo();
          }
          return;

        case 'y':
        case 'Y':
          // Windows convention for redo, alongside Ctrl+Shift+Z.
          if (mod) {
            event.preventDefault();
            onRedo();
          }
          return;

        default:
          if (isPrintable(event)) {
            event.preventDefault();
            onEditStart({ replace: true, initialValue: event.key });
          }
      }
    }

    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [
    bounds,
    enabled,
    onClear,
    onCopy,
    onCut,
    onEditCancel,
    onEditCommit,
    onEditStart,
    onFillDown,
    onPaste,
    onRedo,
    onUndo,
  ]);
}
