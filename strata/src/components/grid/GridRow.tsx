'use client';

import { memo } from 'react';
import type { Item } from '@/server/db/schema/items';
import type { Field } from '@/server/db/schema/itemTypes';
import { cn } from '@/lib/utils';
import { GridCell } from './GridCell';
import type { GridColumn } from './GridHeader';
import type { WorkspaceMemberOption } from './editors/UserEditor';

export interface GridRowProps {
  rowIndex: number;
  item: Item;
  columns: GridColumn[];
  leadingWidth: number;
  members: WorkspaceMemberOption[];
  /** Depth in the work hierarchy, for the indent guide. */
  depth: number;
  onCommit: (rowId: string, field: Field, value: unknown, direction: string) => void;
  onCancel: () => void;
  onMouseDown: (row: number, col: number, shiftKey: boolean) => void;
  onMouseEnter: (row: number, col: number) => void;
  onDoubleClick: (row: number, col: number) => void;
  onOpenDetail: (itemId: string) => void;
}

function GridRowImpl(props: GridRowProps) {
  const { item, columns } = props;
  const invalid = item.invalidValues ?? {};
  const isVariant = item.variantOfId !== null;

  return (
    <div
      role="row"
      aria-rowindex={props.rowIndex + 2}
      className="flex h-[var(--grid-row-height-normal)]"
    >
      {/* Leading gutter: row number, completeness, and the detail affordance.
          Sticky so it survives horizontal scroll — losing track of which row
          you are on while scrolling right is the fastest way to edit the
          wrong one. */}
      <div
        style={{ width: props.leadingWidth, paddingLeft: 4 + props.depth * 12 }}
        className="sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-b border-r bg-[var(--color-surface)] pr-1 text-xs text-[var(--color-ink-subtle)]"
      >
        <span className="tabular w-8 shrink-0 text-right">{props.rowIndex + 1}</span>
        <CompletenessPip pct={item.completenessPct} missing={item.missingRequired.length} />
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-[var(--color-ink)] hover:underline"
          onClick={() => props.onOpenDetail(item.id)}
          title={item.title || 'Untitled'}
        >
          {item.title || <span className="text-[var(--color-ink-subtle)]">Untitled</span>}
        </button>
        {isVariant && (
          <span
            className="shrink-0 rounded bg-[var(--color-muted)] px-1 text-[10px] uppercase tracking-wide"
            title="A variant — shared fields come from its model"
          >
            var
          </span>
        )}
      </div>

      {columns.map((column, col) => (
        <GridCell
          key={column.field.key}
          row={props.rowIndex}
          col={col}
          rowId={item.id}
          field={column.field}
          value={item.effectiveValues[column.field.key] ?? null}
          width={column.width}
          inherited={isVariant && !Object.prototype.hasOwnProperty.call(item.values, column.field.key)}
          invalid={invalid[column.field.key]}
          members={props.members}
          onCommit={props.onCommit}
          onCancel={props.onCancel}
          onMouseDown={props.onMouseDown}
          onMouseEnter={props.onMouseEnter}
          onDoubleClick={props.onDoubleClick}
        />
      ))}
    </div>
  );
}

/** Compact completeness bar. Colour is never the only signal — the % is in the
 *  title, and the detail panel lists the missing fields by name. */
export function CompletenessPip({ pct, missing }: { pct: number; missing: number }) {
  const tone =
    pct === 100
      ? 'bg-[var(--color-success)]'
      : pct >= 60
        ? 'bg-[var(--color-warning)]'
        : 'bg-[var(--color-danger)]';

  return (
    <span
      className="flex h-1.5 w-6 shrink-0 overflow-hidden rounded-full bg-[var(--color-border)]"
      role="img"
      aria-label={`${pct}% complete${missing > 0 ? `, ${missing} required field${missing === 1 ? '' : 's'} missing` : ''}`}
      title={`${pct}% complete${missing > 0 ? ` · ${missing} required missing` : ''}`}
    >
      <span className={cn('h-full', tone)} style={{ width: `${pct}%` }} />
    </span>
  );
}

export const GridRow = memo(GridRowImpl);
