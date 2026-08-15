'use client';

/**
 * The grid.
 *
 * Virtualised rows over a headless TanStack table, with selection, keyboard
 * navigation, clipboard, fill, and undo wired to the change-set write path.
 *
 * Two things here are load-bearing for performance:
 *
 *  1. **Selection never enters React state.** It lives in the Zustand store and
 *     cells subscribe to a packed-integer slice of it. Everything in this file
 *     that touches selection does so through `useGridStore.getState()` inside a
 *     callback, never through a hook that would re-render the whole grid.
 *
 *  2. **Every callback passed to a row is `useCallback`-stable.** `GridCell` is
 *     memoised, and an unstable callback identity defeats the memo entirely —
 *     which looks like the memo "not working" and is the most common way this
 *     architecture is accidentally undone.
 *
 * Writes are optimistic against the server's response, not the local pre-edit
 * value: if a change set fails, the cell rolls back to whatever the server says
 * is current, because another person may have changed it in between.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Item } from '@/server/db/schema/items';
import type { Field } from '@/server/db/schema/itemTypes';
import { api, ApiError } from '@/lib/api';
import { pluralize } from '@/lib/utils';
import type { SortSpec } from '@/types/filters';
import { GridHeader, type GridColumn } from './GridHeader';
import { GridRow } from './GridRow';
import {
  normaliseRect,
  rectSize,
  useGridStore,
  useSelectionSummary,
  type CellCoord,
} from './gridStore';
import { useGridKeyboard } from './useGridKeyboard';
import { buildCopyMatrix, mapPasteToTargets, useGridClipboard } from './useGridClipboard';
import { fillDownTargets, fillHandleTargets } from './useGridFill';
import { describeOperation, useGridUndo } from './useGridUndo';
import type { WorkspaceMemberOption } from './editors/UserEditor';

/** UI/UX §2 medium row height. */
const ROW_HEIGHT = 40;
const LEADING_WIDTH = 260;
const OVERSCAN = 12;
const DEFAULT_COLUMN_WIDTH = 160;

export interface GridProps {
  items: Item[];
  fields: Field[];
  itemTypeId: string;
  members: WorkspaceMemberOption[];
  sort: SortSpec[];
  columnWidths: Record<string, number>;
  pinnedFieldKeys: string[];
  visibleFieldKeys?: string[];
  onSortChange: (sort: SortSpec[]) => void;
  onColumnWidthChange: (widths: Record<string, number>) => void;
  onPinnedChange: (keys: string[]) => void;
  onFieldOrderChange: (keys: string[]) => void;
  onOpenDetail: (itemId: string) => void;
  /** `/` — the workspace focuses its filter bar. */
  onFocusFilter?: () => void;
  /** Ctrl/Cmd+K — the workspace opens its command affordance. */
  onCommandPalette?: () => void;
  onDataChanged: () => void;
  onToast: (toast: { message: string; undo?: () => void; tone?: 'info' | 'error' }) => void;
  /** Guests may only edit the fields granted to them; null means all. */
  editableFieldKeys?: string[] | null;
}

export function Grid(props: GridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fillAnchor, setFillAnchor] = useState<CellCoord | null>(null);
  const clipboard = useGridClipboard();
  const undoController = useGridUndo(props.onDataChanged);
  const selectionSummary = useSelectionSummary();

  const columns: GridColumn[] = useMemo(() => {
    const visible = props.visibleFieldKeys
      ? props.fields.filter((f) => props.visibleFieldKeys?.includes(f.key))
      : props.fields;
    const ordered = props.visibleFieldKeys
      ? [...visible].sort(
          (a, b) =>
            (props.visibleFieldKeys?.indexOf(a.key) ?? 0) -
            (props.visibleFieldKeys?.indexOf(b.key) ?? 0),
        )
      : visible;
    return ordered.map((field) => ({
      field,
      width: props.columnWidths[field.key] ?? DEFAULT_COLUMN_WIDTH,
      pinned: props.pinnedFieldKeys.includes(field.key),
    }));
  }, [props.fields, props.visibleFieldKeys, props.columnWidths, props.pinnedFieldKeys]);

  const bounds = useMemo(
    () => ({ rows: props.items.length, cols: columns.length }),
    [props.items.length, columns.length],
  );

  const depthOf = useCallback((item: Item) => Math.max(item.path.split('.').length - 1, 0), []);

  const virtualizer = useVirtualizer({
    count: props.items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
  });

  // --- helpers -------------------------------------------------------------

  const rawValueAt = useCallback(
    (row: number, col: number): unknown => {
      const item = props.items[row];
      const field = columns[col]?.field;
      if (!item || !field) return null;
      return item.effectiveValues[field.key] ?? null;
    },
    [props.items, columns],
  );

  const textValueAt = useCallback(
    (row: number, col: number): string => {
      const value = rawValueAt(row, col);
      if (value === null || value === undefined) return '';
      return Array.isArray(value) ? value.join(', ') : String(value);
    },
    [rawValueAt],
  );

  const isEditable = useCallback(
    (field: Field) =>
      props.editableFieldKeys === null ||
      props.editableFieldKeys === undefined ||
      props.editableFieldKeys.includes(field.key),
    [props.editableFieldKeys],
  );

  /**
   * Writes a batch through the change-set endpoint.
   *
   * One change set per distinct patch, grouping every row that shares it —
   * so a 300-row paste of one column is one undoable step, not 300.
   */
  const writeCells = useCallback(
    async (
      targets: Array<{ row: number; col: number; value: unknown }>,
      operationLabel: string,
      opts?: { confirmInvalid?: boolean },
    ): Promise<void> => {
      if (targets.length === 0) return;

      const groups = new Map<string, { fieldKey: string; value: unknown; itemIds: string[] }>();
      const blocked: string[] = [];

      for (const target of targets) {
        const item = props.items[target.row];
        const field = columns[target.col]?.field;
        if (!item || !field) continue;
        if (!isEditable(field)) {
          if (!blocked.includes(field.label)) blocked.push(field.label);
          continue;
        }
        const key = `${field.key}::${JSON.stringify(target.value ?? null)}`;
        const existing = groups.get(key);
        if (existing) existing.itemIds.push(item.id);
        else groups.set(key, { fieldKey: field.key, value: target.value, itemIds: [item.id] });
      }

      if (groups.size === 0) {
        props.onToast({
          message: blocked.length
            ? `You can't edit ${blocked.join(', ')} here.`
            : 'Nothing to change.',
          tone: 'error',
        });
        return;
      }

      const rowIds = [...new Set([...groups.values()].flatMap((g) => g.itemIds))];
      useGridStore.getState().markPending(rowIds);

      try {
        const committedIds: string[] = [];
        let totalItems = 0;

        // Paste previews before committing (UI/UX §5.1): every group is
        // created as a preview first, invalid counts are summed across them,
        // and the user confirms before anything lands.
        const preview = opts?.confirmInvalid === true;
        const pendingPreviews: Array<{ id: string; itemCount: number }> = [];
        let invalidCount = 0;

        for (const group of groups.values()) {
          const result = await api.changeSets.create({
            operation: 'set_field',
            itemTypeId: props.itemTypeId,
            target: { kind: 'ids', itemIds: group.itemIds },
            patch: { values: { [group.fieldKey]: group.value } },
            autoCommit: !preview,
          });

          if (preview) {
            pendingPreviews.push({ id: result.id, itemCount: result.itemCount });
            for (const bucket of Object.values(result.summary.byField ?? {})) {
              invalidCount += bucket.invalid ?? 0;
            }
          } else if (result.committed) {
            committedIds.push(result.id);
            totalItems += result.appliedCount ?? group.itemIds.length;
          } else {
            // Above the bulk threshold the server refuses to auto-commit; the
            // preview is waiting and the user has to look at it.
            props.onToast({
              message: result.message ?? 'This change needs review before it can be applied.',
              tone: 'info',
            });
          }
        }

        if (preview) {
          const proceed =
            invalidCount === 0 ||
            window.confirm(
              `${invalidCount} pasted value${invalidCount === 1 ? '' : 's'} won't convert to the column's type and will be flagged instead of stored. Paste anyway?`,
            );
          for (const pending of pendingPreviews) {
            if (proceed) {
              await api.changeSets.commit(pending.id);
              committedIds.push(pending.id);
              totalItems += pending.itemCount;
            } else {
              await api.changeSets.discard(pending.id);
            }
          }
          if (!proceed) return; // `finally` clears the pending markers

        }

        if (committedIds.length > 0) {
          undoController.record({
            changeSetIds: committedIds,
            label: operationLabel,
            itemCount: totalItems,
          });
          props.onToast({
            message: describeOperation('set_field', totalItems),
            undo: () => {
              void undoController.undo().then((outcome) => {
                if (outcome.status === 'failed') {
                  props.onToast({ message: outcome.message, tone: 'error' });
                }
              });
            },
          });
        }

        if (blocked.length) {
          props.onToast({
            message: `Skipped ${blocked.join(', ')} — you don't have access to those fields.`,
            tone: 'info',
          });
        }

        props.onDataChanged();
      } catch (error) {
        const message =
          error instanceof ApiError ? error.message : 'That change could not be saved.';
        for (const group of groups.values()) {
          for (const itemId of group.itemIds) {
            useGridStore.getState().setCellError(itemId, group.fieldKey, message);
          }
        }
        props.onToast({ message, tone: 'error' });
        // Refetch rather than reverting locally: the server's value is the
        // truth, and it may already differ from what this tab had before the
        // edit if someone else was editing the same rows.
        props.onDataChanged();
      } finally {
        useGridStore.getState().clearPending(rowIds);
      }
    },
    [columns, isEditable, props, undoController],
  );

  // --- pointer interaction -------------------------------------------------

  const handleMouseDown = useCallback((row: number, col: number, shiftKey: boolean) => {
    const store = useGridStore.getState();
    if (shiftKey && store.selection) store.extendTo({ row, col });
    else store.selectCell({ row, col });
    store.setDragging(true);
  }, []);

  const handleMouseEnter = useCallback((row: number, col: number) => {
    const store = useGridStore.getState();
    if (store.isDragging) store.extendTo({ row, col });
    else if (fillAnchorRef.current) store.setFillTarget({ row, col });
  }, []);

  const fillAnchorRef = useRef<CellCoord | null>(null);
  useEffect(() => {
    fillAnchorRef.current = fillAnchor;
  }, [fillAnchor]);

  useEffect(() => {
    function onPointerUp(): void {
      const store = useGridStore.getState();
      store.setDragging(false);

      const target = store.fillTarget;
      if (fillAnchorRef.current && target && store.selection) {
        const rect = normaliseRect(store.selection);
        const targets = fillHandleTargets(
          rect,
          target.row,
          (col) => columns[col]?.field.type ?? 'text',
          textValueAt,
        );
        void writeCells(targets, 'Fill');
      }
      store.setFillTarget(null);
      setFillAnchor(null);
    }
    window.addEventListener('pointerup', onPointerUp);
    return () => window.removeEventListener('pointerup', onPointerUp);
  }, [columns, textValueAt, writeCells]);

  const handleDoubleClick = useCallback((row: number, col: number) => {
    useGridStore.getState().beginEdit({ row, col, replace: false });
  }, []);

  // --- keyboard actions ----------------------------------------------------

  const commitEdit = useCallback(
    (rowId: string, field: Field, value: unknown, direction: string) => {
      const store = useGridStore.getState();
      const editing = store.editing;
      store.endEdit();
      store.setCellError(rowId, field.key, null);

      if (editing) {
        void writeCells([{ row: editing.row, col: editing.col, value }], `Edit ${field.label}`);
      }

      if (direction && direction !== 'none') {
        const delta =
          direction === 'down'
            ? { row: 1, col: 0 }
            : direction === 'up'
              ? { row: -1, col: 0 }
              : direction === 'right'
                ? { row: 0, col: 1 }
                : { row: 0, col: -1 };
        store.moveFocus(delta, bounds, false);
      }
    },
    [bounds, writeCells],
  );

  const handleEditStart = useCallback(
    ({ replace, initialValue }: { replace: boolean; initialValue?: string }) => {
      const store = useGridStore.getState();
      const selection = store.selection;
      if (!selection) return;
      const field = columns[selection.focus.col]?.field;
      if (!field || !isEditable(field)) return;
      store.beginEdit({ row: selection.focus.row, col: selection.focus.col, replace, initialValue });
    },
    [columns, isEditable],
  );

  const handleClear = useCallback(() => {
    const selection = useGridStore.getState().selection;
    if (!selection) return;
    const rect = normaliseRect(selection);
    const targets: Array<{ row: number; col: number; value: unknown }> = [];
    for (let row = rect.top; row <= rect.bottom; row += 1) {
      for (let col = rect.left; col <= rect.right; col += 1) {
        targets.push({ row, col, value: null });
      }
    }
    void writeCells(targets, 'Clear cells');
  }, [writeCells]);

  const handleCopy = useCallback(() => {
    const selection = useGridStore.getState().selection;
    if (!selection) return;
    const rect = normaliseRect(selection);
    const rows = props.items.slice(rect.top, rect.bottom + 1);
    const fields = columns.slice(rect.left, rect.right + 1).map((c) => c.field);
    void clipboard.copy(buildCopyMatrix(rows as unknown as Array<Record<string, unknown>>, fields));
  }, [clipboard, columns, props.items]);

  const handleCut = useCallback(() => {
    handleCopy();
    handleClear();
  }, [handleClear, handleCopy]);

  const handlePaste = useCallback(() => {
    const selection = useGridStore.getState().selection;
    if (!selection) return;
    const rect = normaliseRect(selection);

    void clipboard.read().then(async (matrix) => {
      const targets = mapPasteToTargets(matrix, rect, bounds);

      // §5.1: pasting more rows than exist offers to create the extra items
      // rather than silently truncating.
      const overflowRows = matrix.length - (bounds.rows - rect.top);
      if (overflowRows > 0) {
        const create = window.confirm(
          `The pasted block has ${overflowRows} more row${overflowRows === 1 ? '' : 's'} than the grid. Create ${overflowRows === 1 ? 'a new item' : `${overflowRows} new items`} for them?`,
        );
        if (create) {
          const overflow = matrix.slice(matrix.length - overflowRows);
          const drafts = overflow.map((cells) => {
            const values: Record<string, unknown> = {};
            cells.forEach((value, i) => {
              const field = columns[rect.left + i]?.field;
              if (field && value !== '') values[field.key] = value;
            });
            return { title: '', values };
          });
          try {
            const result = await api.changeSets.create({
              operation: 'create',
              itemTypeId: props.itemTypeId,
              target: { kind: 'new', drafts },
              autoCommit: true,
            });
            undoController.record({
              changeSetIds: [result.id],
              label: 'Paste (new items)',
              itemCount: drafts.length,
            });
          } catch {
            props.onToast({ message: 'Could not create the extra rows.', tone: 'error' });
          }
        }
      }

      if (targets.length === 0) {
        props.onDataChanged();
        return;
      }

      // Paste previews non-convertible values before committing (§5.1);
      // `writeCells` sums the invalid counts across its previews and asks.
      void writeCells(
        targets.map((t) => ({ row: t.row, col: t.col, value: t.value })),
        'Paste',
        { confirmInvalid: targets.length > 1 },
      );
    });
  }, [bounds, clipboard, columns, props, undoController, writeCells]);

  const handleFillDown = useCallback(() => {
    const selection = useGridStore.getState().selection;
    if (!selection) return;
    const rect = normaliseRect(selection);
    if (rect.bottom === rect.top) return;
    void writeCells(fillDownTargets(rect, textValueAt), 'Fill down');
  }, [textValueAt, writeCells]);

  const handleUndo = useCallback(() => {
    void undoController.undo().then((outcome) => {
      if (outcome.status === 'failed') props.onToast({ message: outcome.message, tone: 'error' });
      else if (outcome.status === 'undone') {
        props.onToast({ message: `Undid: ${outcome.label}` });
      }
    });
  }, [props, undoController]);

  const handleRedo = useCallback(() => {
    void undoController.redo().then((outcome) => {
      if (outcome.status === 'failed') props.onToast({ message: outcome.message, tone: 'error' });
    });
  }, [props, undoController]);

  useGridKeyboard({
    bounds,
    enabled: true,
    onEditStart: handleEditStart,
    onEditCommit: () => {
      /* The editor calls `commit` itself; Enter/Tab only move the focus. */
    },
    onEditCancel: () => useGridStore.getState().endEdit(),
    onClear: handleClear,
    onCopy: handleCopy,
    onCut: handleCut,
    onPaste: handlePaste,
    onFillDown: handleFillDown,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onOpenDetail: () => {
      const focus = useGridStore.getState().selection?.focus;
      const item = focus ? props.items[focus.row] : undefined;
      if (item) props.onOpenDetail(item.id);
    },
    onSpace: () => {
      // Space toggles a checkbox cell (UI/UX 5.1); on any other type it is
      // deliberately inert rather than clearing or editing the value.
      const focus = useGridStore.getState().selection?.focus;
      if (!focus) return;
      const item = props.items[focus.row];
      const field = columns[focus.col]?.field;
      if (!item || !field || field.type !== 'checkbox') return;
      const current = item.effectiveValues[field.key] === true;
      void writeCells([{ row: focus.row, col: focus.col, value: !current }], 'Toggle');
    },
    onFocusFilter: () => props.onFocusFilter?.(),
    onCommandPalette: () => props.onCommandPalette?.(),
  });

  const totalWidth = LEADING_WIDTH + columns.reduce((sum, c) => sum + c.width, 0);
  const virtualRows = virtualizer.getVirtualItems();

  return (
    <div className="flex h-full flex-col">
      <div
        ref={scrollRef}
        className="grid-surface scrollbar-thin relative flex-1 overflow-auto bg-[var(--color-surface)]"
        role="grid"
        aria-rowcount={props.items.length + 1}
        aria-colcount={columns.length + 1}
        aria-label="Items"
        tabIndex={0}
      >
        <div style={{ width: totalWidth }}>
          <GridHeader
            columns={columns}
            sort={props.sort}
            leadingWidth={LEADING_WIDTH}
            onSort={(fieldKey, additive) => {
              const existing = props.sort.find((s) => s.field === fieldKey);
              const next: SortSpec = {
                field: fieldKey,
                direction: existing?.direction === 'asc' ? 'desc' : 'asc',
              };
              props.onSortChange(
                additive ? [...props.sort.filter((s) => s.field !== fieldKey), next] : [next],
              );
            }}
            onResize={(fieldKey, width) =>
              props.onColumnWidthChange({ ...props.columnWidths, [fieldKey]: width })
            }
            onTogglePin={(fieldKey) =>
              props.onPinnedChange(
                props.pinnedFieldKeys.includes(fieldKey)
                  ? props.pinnedFieldKeys.filter((k) => k !== fieldKey)
                  : [...props.pinnedFieldKeys, fieldKey],
              )
            }
            onReorder={(fieldKey, toIndex) => {
              const keys = columns.map((c) => c.field.key).filter((k) => k !== fieldKey);
              keys.splice(toIndex, 0, fieldKey);
              props.onFieldOrderChange(keys);
            }}
          />

          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualRows.map((virtualRow) => {
              const item = props.items[virtualRow.index];
              if (!item) return null;
              return (
                <div
                  key={item.id}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <GridRow
                    rowIndex={virtualRow.index}
                    item={item}
                    columns={columns}
                    leadingWidth={LEADING_WIDTH}
                    members={props.members}
                    depth={depthOf(item)}
                    onCommit={commitEdit}
                    onCancel={() => useGridStore.getState().endEdit()}
                    onMouseDown={handleMouseDown}
                    onMouseEnter={handleMouseEnter}
                    onDoubleClick={handleDoubleClick}
                    onOpenDetail={props.onOpenDetail}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className="flex h-7 shrink-0 items-center justify-between border-t bg-[var(--color-muted)] px-3 text-xs text-[var(--color-ink-muted)]"
        role="status"
        aria-live="polite"
      >
        <span>{pluralize(props.items.length, 'item')}</span>
        {selectionSummary && (
          <span>
            {pluralize(selectionSummary.cells, 'cell')}, {pluralize(selectionSummary.rows, 'row')}
          </span>
        )}
      </div>
    </div>
  );
}

export { rectSize };
