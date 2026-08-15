'use client';

import { memo } from 'react';
import type { Field } from '@/server/db/schema/itemTypes';
import { formatValue } from '@/server/validation/fieldTypes';
import { cn } from '@/lib/utils';
import { CellFlags, useCellFlags, useGridStore } from './gridStore';
import { EDITORS } from './editors';
import type { WorkspaceMemberOption } from './editors/UserEditor';

export interface GridCellProps {
  row: number;
  col: number;
  rowId: string;
  field: Field;
  value: unknown;
  width: number;
  /** Set when this cell's value comes from a variant model, not the item. */
  inherited?: boolean;
  /** Set when the stored value failed coercion; shows the raw text and why. */
  invalid?: { raw: unknown; message: string };
  members?: WorkspaceMemberOption[];
  onCommit: (rowId: string, field: Field, value: unknown, direction: string) => void;
  onCancel: () => void;
  onMouseDown: (row: number, col: number, shiftKey: boolean) => void;
  onMouseEnter: (row: number, col: number) => void;
  onDoubleClick: (row: number, col: number) => void;
}

/**
 * A single cell.
 *
 * **Memoised on `(value, flags, width)` and nothing else.** The flags come from
 * `useCellFlags`, which returns a packed integer so the subscription compares
 * with `Object.is` and re-renders only when this cell's own selected/focused/
 * editing state changes. Passing the selection rectangle down as a prop — the
 * obvious implementation — re-renders every mounted cell on every arrow key,
 * and at 10k rows that is the difference between 60fps and single digits.
 *
 * The callbacks must be stable (`useCallback` in the parent) or the memo is
 * defeated by prop identity alone.
 */
/**
 * A `user` field stores an id, which is correct for storage and useless on
 * screen. Resolution happens here against the member list the grid already
 * loaded once, rather than in `formatValue` — the server-side formatter has no
 * access to workspace members, and giving it one would mean a lookup per cell.
 */
function formatUserAware(
  type: Field['type'],
  value: unknown,
  config: Field['config'],
  members: GridCellProps['members'],
): string {
  if (type !== 'user' || value === null || value === undefined) {
    return formatValue(type, value, config);
  }
  const ids = Array.isArray(value) ? value.map(String) : [String(value)];
  return ids
    .map((id) => {
      const member = members?.find((m) => m.id === id);
      return member ? (member.name ?? member.email) : id;
    })
    .join(', ');
}

function GridCellImpl(props: GridCellProps) {
  const flags = useCellFlags(props.row, props.col);
  const isSelected = (flags & CellFlags.Selected) !== 0;
  const isFocused = (flags & CellFlags.Focused) !== 0;
  const isEditing = (flags & CellFlags.Editing) !== 0;
  const inFillPreview = (flags & CellFlags.InFillPreview) !== 0;

  const pending = useGridStore((s) => s.pendingRows.has(props.rowId));
  const error = useGridStore((s) => s.cellErrors[`${props.rowId}:${props.field.key}`]);
  const editing = useGridStore((s) => (isEditing ? s.editing : null));

  const Editor = EDITORS[props.field.type];
  const display = props.invalid
    ? String(props.invalid.raw ?? '')
    : formatUserAware(props.field.type, props.value, props.field.config, props.members);

  const numeric =
    props.field.type === 'number' ||
    props.field.type === 'currency' ||
    props.field.type === 'percent';

  return (
    <div
      role="gridcell"
      aria-selected={isSelected}
      aria-readonly={false}
      aria-invalid={Boolean(props.invalid || error)}
      tabIndex={-1}
      style={{ width: props.width }}
      className={cn(
        'relative shrink-0 border-b border-r px-2 text-sm leading-[var(--grid-row-height-normal)]',
        'cell-text select-none',
        numeric && 'text-right tabular',
        isSelected && 'bg-[var(--color-accent-soft)]',
        inFillPreview && 'bg-[var(--color-accent-soft)] ring-1 ring-inset ring-[var(--color-accent-ring)]',
        isFocused && 'z-10 outline outline-2 -outline-offset-1 outline-[var(--color-accent)]',
        pending && 'opacity-60',
        (props.invalid || error) && 'bg-[var(--color-danger-soft)]',
        // Inherited values read differently so a variant's grid says at a
        // glance which cells are the model's and which the variant owns.
        props.inherited && 'italic text-[var(--color-ink-subtle)]',
      )}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        props.onMouseDown(props.row, props.col, e.shiftKey);
      }}
      onMouseEnter={() => props.onMouseEnter(props.row, props.col)}
      onDoubleClick={() => props.onDoubleClick(props.row, props.col)}
      title={props.invalid?.message ?? error ?? (display || undefined)}
    >
      {isEditing && editing ? (
        <Editor
          field={props.field}
          value={props.value}
          initialValue={editing.initialValue}
          replace={editing.replace}
          commit={(value, direction) =>
            props.onCommit(props.rowId, props.field, value, direction ?? 'none')
          }
          cancel={props.onCancel}
          {...(props.field.type === 'user' ? { members: props.members } : {})}
        />
      ) : (
        <span className="pointer-events-none block truncate">{display}</span>
      )}

      {props.invalid && !isEditing && (
        <span
          aria-hidden
          className="pointer-events-none absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--color-danger)]"
        />
      )}
    </div>
  );
}

export const GridCell = memo(GridCellImpl, (prev, next) => {
  // Everything selection-related is read from the store inside the component,
  // so it is deliberately absent from this comparison.
  return (
    prev.value === next.value &&
    prev.width === next.width &&
    prev.rowId === next.rowId &&
    prev.row === next.row &&
    prev.col === next.col &&
    prev.field === next.field &&
    prev.inherited === next.inherited &&
    prev.invalid === next.invalid &&
    prev.members === next.members
  );
});
