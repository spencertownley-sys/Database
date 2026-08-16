'use client';

import { memo, useCallback, useRef } from 'react';
import { ArrowDown, ArrowUp, GripVertical, Pin } from 'lucide-react';
import type { Field } from '@/server/db/schema/itemTypes';
import { cn } from '@/lib/utils';
import type { SortSpec } from '@/types/filters';

export interface GridColumn {
  field: Field;
  width: number;
  pinned: boolean;
}

export interface GridHeaderProps {
  columns: GridColumn[];
  sort: SortSpec[];
  onSort: (fieldKey: string, additive: boolean) => void;
  onResize: (fieldKey: string, width: number) => void;
  onReorder: (fieldKey: string, toIndex: number) => void;
  onTogglePin: (fieldKey: string) => void;
  leadingWidth: number;
}

const MIN_WIDTH = 60;
const MAX_WIDTH = 800;

function GridHeaderImpl(props: GridHeaderProps) {
  const dragKey = useRef<string | null>(null);

  const startResize = useCallback(
    (fieldKey: string, startX: number, startWidth: number) => {
      // Pointer events on window rather than the handle: the cursor routinely
      // leaves the 4px handle mid-drag, and a handle-scoped listener drops the
      // drag the moment it does.
      function onMove(event: PointerEvent): void {
        const next = Math.min(Math.max(startWidth + event.clientX - startX, MIN_WIDTH), MAX_WIDTH);
        props.onResize(fieldKey, next);
      }
      function onUp(): void {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      }
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [props],
  );

  return (
    <div
      role="row"
      className="sticky top-0 z-20 flex h-[var(--grid-header-height)] bg-[var(--color-muted)] text-xs font-medium text-[var(--color-ink-muted)]"
    >
      <div
        role="columnheader"
        style={{ width: props.leadingWidth }}
        className="sticky left-0 z-10 shrink-0 border-b border-r bg-[var(--color-muted)]"
      />

      {props.columns.map((column, index) => {
        const spec = props.sort.find((s) => s.field === column.field.key);
        return (
          <div
            key={column.field.key}
            role="columnheader"
            aria-sort={spec ? (spec.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
            style={{ width: column.width }}
            className={cn(
              'group relative flex shrink-0 items-center gap-1 border-b border-r px-2',
              column.pinned && 'sticky z-10 bg-[var(--color-muted)]',
            )}
            draggable
            onDragStart={() => {
              dragKey.current = column.field.key;
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (dragKey.current && dragKey.current !== column.field.key) {
                props.onReorder(dragKey.current, index);
              }
              dragKey.current = null;
            }}
          >
            <GripVertical
              aria-hidden
              className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-40"
            />

            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1 text-left"
              onClick={(e) => props.onSort(column.field.key, e.shiftKey)}
              title={`Sort by ${column.field.label}`}
            >
              <span className="truncate">{column.field.label}</span>
              {column.field.requiredForCompleteness && (
                <span aria-label="required" className="text-[var(--color-danger)]">
                  *
                </span>
              )}
              {spec &&
                (spec.direction === 'asc' ? (
                  <ArrowUp className="h-3 w-3 shrink-0" />
                ) : (
                  <ArrowDown className="h-3 w-3 shrink-0" />
                ))}
            </button>

            <button
              type="button"
              aria-label={column.pinned ? `Unfreeze ${column.field.label}` : `Freeze ${column.field.label}`}
              className={cn(
                'shrink-0 rounded p-0.5 opacity-0 transition-opacity group-hover:opacity-60',
                column.pinned && 'opacity-100',
              )}
              onClick={() => props.onTogglePin(column.field.key)}
            >
              <Pin className="h-3 w-3" />
            </button>

            <div
              role="separator"
              aria-orientation="vertical"
              aria-label={`Resize ${column.field.label}`}
              className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[var(--color-accent)]"
              onPointerDown={(e) => {
                e.preventDefault();
                startResize(column.field.key, e.clientX, column.width);
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

export const GridHeader = memo(GridHeaderImpl);
