'use client';

/**
 * The local undo stack, mapped onto server change sets.
 *
 * Every grid write — one cell or three hundred rows — produces a committed
 * change set, and its id is what goes on this stack. `Ctrl+Z` pops the stack
 * and calls the change set's `undo` endpoint, so the two cases are the same
 * code path and cannot drift in behaviour.
 *
 * The stack is local and per-session on purpose. It is a record of *what this
 * person just did in this tab*, which is the thing Ctrl+Z is expected to
 * reverse — not a workspace-wide history, where undoing would silently revert
 * a colleague's work.
 */

import { useCallback } from 'react';
import { api, ApiError } from '@/lib/api';
import { useGridStore, type UndoEntry } from './gridStore';

export interface UndoController {
  record: (entry: Omit<UndoEntry, 'at'>) => void;
  undo: () => Promise<UndoOutcome>;
  redo: () => Promise<UndoOutcome>;
  canUndo: boolean;
  canRedo: boolean;
}

export type UndoOutcome =
  | { status: 'none' }
  | { status: 'undone'; label: string; itemCount: number }
  | { status: 'redone'; label: string; itemCount: number }
  | { status: 'failed'; message: string };

export function useGridUndo(onChanged: () => void): UndoController {
  const canUndo = useGridStore((s) => s.undoStack.length > 0);
  const canRedo = useGridStore((s) => s.redoStack.length > 0);

  const record = useCallback((entry: Omit<UndoEntry, 'at'>) => {
    useGridStore.getState().pushUndo({ ...entry, at: Date.now() });
  }, []);

  const undo = useCallback(async (): Promise<UndoOutcome> => {
    const store = useGridStore.getState();
    const entry = store.popUndo();
    if (!entry) return { status: 'none' };

    try {
      // Reverse commit order, so overlapping writes unwind the way they landed.
      const undoIds: string[] = [];
      for (const changeSetId of [...entry.changeSetIds].reverse()) {
        const result = await api.changeSets.undo(changeSetId);
        undoIds.push(result.undoChangeSetId);
      }
      // The undo is itself a change set, so redo is undoing *that* one rather
      // than replaying the original — which keeps redo exact even if the
      // original operation is no longer expressible against current data.
      store.pushRedo({
        changeSetIds: undoIds,
        label: entry.label,
        itemCount: entry.itemCount,
        at: Date.now(),
      });
      onChanged();
      return { status: 'undone', label: entry.label, itemCount: entry.itemCount };
    } catch (error) {
      // Put it back: a failed undo must not consume the stack entry, or the
      // user loses the ability to retry after fixing whatever blocked it.
      store.pushUndo(entry);
      onChanged();
      return {
        status: 'failed',
        message:
          error instanceof ApiError ? error.message : 'That change could not be undone.',
      };
    }
  }, [onChanged]);

  const redo = useCallback(async (): Promise<UndoOutcome> => {
    const store = useGridStore.getState();
    const entry = store.popRedo();
    if (!entry) return { status: 'none' };

    try {
      const undoIds: string[] = [];
      for (const changeSetId of [...entry.changeSetIds].reverse()) {
        const result = await api.changeSets.undo(changeSetId);
        undoIds.push(result.undoChangeSetId);
      }
      store.pushUndo({
        changeSetIds: undoIds,
        label: entry.label,
        itemCount: entry.itemCount,
        at: Date.now(),
      });
      onChanged();
      return { status: 'redone', label: entry.label, itemCount: entry.itemCount };
    } catch (error) {
      store.pushRedo(entry);
      onChanged();
      return {
        status: 'failed',
        message:
          error instanceof ApiError ? error.message : 'That change could not be redone.',
      };
    }
  }, [onChanged]);

  return { record, undo, redo, canUndo, canRedo };
}

/** Human label for the undo toast: "Undo status change on 42 items". */
export function describeOperation(operation: string, itemCount: number): string {
  const noun = itemCount === 1 ? 'item' : 'items';
  switch (operation) {
    case 'create':
      return `Created ${itemCount} ${noun}`;
    case 'set_field':
      return `Updated ${itemCount} ${noun}`;
    case 'clear_field':
      return `Cleared values on ${itemCount} ${noun}`;
    case 'change_type':
      return `Changed the type of ${itemCount} ${noun}`;
    case 'reparent':
      return `Moved ${itemCount} ${noun}`;
    case 'tree_assign':
      return `Filed ${itemCount} ${noun}`;
    case 'tree_unassign':
      return `Removed ${itemCount} ${noun} from a category`;
    case 'delete':
      return `Deleted ${itemCount} ${noun}`;
    case 'assign_user':
      return `Reassigned ${itemCount} ${noun}`;
    default:
      return `Changed ${itemCount} ${noun}`;
  }
}
