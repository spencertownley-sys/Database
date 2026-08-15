'use client';

/**
 * Board view — the Contributor's screen (UI/UX §3.6). Someone can live here
 * for months and never learn the data model.
 *
 * Columns group by any `select` or `user` field. Dragging a card between
 * columns writes the field **via a change set** and surfaces the same undo
 * toast as everywhere else — consistency across surfaces matters more than
 * board-specific polish.
 */

import { useMemo, useState } from 'react';
import type { Item } from '@/server/db/schema/items';
import type { Field } from '@/server/db/schema/itemTypes';
import { api, ApiError } from '@/lib/api';
import type { SelectOption } from '@/types/fields';
import { CompletenessBar } from '@/components/item-detail/CompletenessBar';
import type { WorkspaceMemberOption } from '@/components/grid/editors/UserEditor';

export interface BoardViewProps {
  items: Item[];
  fields: Field[];
  itemTypeId: string;
  members: WorkspaceMemberOption[];
  groupFieldKey: string | null;
  onGroupFieldChange: (key: string) => void;
  onOpenDetail: (itemId: string) => void;
  onDataChanged: () => void;
  onToast: (toast: { message: string; tone?: 'info' | 'error'; undo?: () => void }) => void;
}

interface BoardColumn {
  key: string | null;
  label: string;
  color?: string;
  items: Item[];
}

export function BoardView(props: BoardViewProps) {
  const [dragItemId, setDragItemId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const groupable = useMemo(
    () => props.fields.filter((f) => f.type === 'select' || f.type === 'user'),
    [props.fields],
  );
  const groupField =
    groupable.find((f) => f.key === props.groupFieldKey) ?? groupable[0] ?? null;

  const columns = useMemo(
    () => (groupField ? buildColumns(props.items, groupField, props.members) : []),
    [props.items, groupField, props.members],
  );

  if (!groupField) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <p className="text-sm font-medium">A board needs a select or user field to group by.</p>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Add a Status-style select field to this Item Type and the board builds itself.
        </p>
      </div>
    );
  }

  const moveCard = async (itemId: string, toColumn: string | null) => {
    setDragItemId(null);
    setDropTarget(null);
    const item = props.items.find((i) => i.id === itemId);
    if (!item || (item.effectiveValues[groupField.key] ?? null) === toColumn) return;

    try {
      const result = await api.changeSets.create({
        operation: 'set_field',
        itemTypeId: props.itemTypeId,
        target: { kind: 'ids', itemIds: [itemId] },
        patch: { values: { [groupField.key]: toColumn } },
        autoCommit: true,
      });
      const changeSetId = result.id;
      props.onToast({
        message: `Moved "${item.title}"`,
        undo: () => {
          void api.changeSets
            .undo(changeSetId)
            .then(() => props.onDataChanged())
            .catch(() => props.onToast({ message: 'Could not undo that move.', tone: 'error' }));
        },
      });
      props.onDataChanged();
    } catch (error) {
      props.onToast({
        message: error instanceof ApiError ? error.message : 'Could not move that card.',
        tone: 'error',
      });
      props.onDataChanged();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-xs text-[var(--color-ink-muted)]">
        <label htmlFor="board-group-field">Group by</label>
        <select
          id="board-group-field"
          className="rounded border px-1.5 py-0.5 text-xs"
          value={groupField.key}
          onChange={(e) => props.onGroupFieldChange(e.target.value)}
        >
          {groupable.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
        {columns.map((column) => (
          <section
            key={column.key ?? '∅'}
            aria-label={`${column.label} — ${column.items.length} items`}
            className={`flex w-64 shrink-0 flex-col rounded-[var(--radius-lg)] border bg-[var(--color-muted)] ${
              dropTarget === (column.key ?? '∅') ? 'border-[var(--color-accent)]' : ''
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDropTarget(column.key ?? '∅');
            }}
            onDragLeave={() => setDropTarget(null)}
            onDrop={() => dragItemId && void moveCard(dragItemId, column.key)}
          >
            <header className="flex items-center gap-2 px-3 py-2 text-xs font-medium">
              {column.color && (
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: column.color }}
                />
              )}
              <span className="truncate">{column.label}</span>
              <span className="tabular text-[var(--color-ink-subtle)]">{column.items.length}</span>
            </header>

            <div className="flex min-h-8 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {column.items.map((item) => (
                <article
                  key={item.id}
                  draggable
                  onDragStart={() => setDragItemId(item.id)}
                  onDragEnd={() => {
                    setDragItemId(null);
                    setDropTarget(null);
                  }}
                  className="cursor-grab rounded-[var(--radius-md)] border bg-[var(--color-surface)] p-2 shadow-sm active:cursor-grabbing"
                >
                  <button
                    type="button"
                    className="w-full truncate text-left text-sm font-medium hover:underline"
                    onClick={() => props.onOpenDetail(item.id)}
                    title={item.title}
                  >
                    {item.title || 'Untitled'}
                  </button>
                  <div className="mt-2">
                    <CompletenessBar pct={item.completenessPct} compact />
                  </div>
                </article>
              ))}
              {column.items.length === 0 && (
                <p
                  className="rounded border border-dashed p-3 text-center text-xs text-[var(--color-ink-subtle)]"
                  aria-hidden
                >
                  {column.label}
                </p>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * One column per option (or member), in the field's declared order, plus a
 * trailing "No value" bucket. Every declared option gets a column even when
 * empty — an empty column is a drop target, not a rendering gap.
 */
function buildColumns(
  items: readonly Item[],
  field: Field,
  members: readonly WorkspaceMemberOption[],
): BoardColumn[] {
  const buckets = new Map<string | null, Item[]>();
  for (const item of items) {
    const raw = item.effectiveValues[field.key];
    const key = raw === undefined || raw === null || raw === '' ? null : String(raw);
    const list = buckets.get(key);
    if (list) list.push(item);
    else buckets.set(key, [item]);
  }

  const columns: BoardColumn[] = [];

  if (field.type === 'select') {
    const options = (field.config as { options?: SelectOption[] }).options ?? [];
    for (const option of options) {
      columns.push({
        key: option.id,
        label: option.label,
        color: option.color,
        items: buckets.get(option.id) ?? [],
      });
      buckets.delete(option.id);
    }
  } else {
    for (const member of members) {
      if (!buckets.has(member.id)) continue;
      columns.push({
        key: member.id,
        label: member.name ?? member.email,
        items: buckets.get(member.id) ?? [],
      });
      buckets.delete(member.id);
    }
  }

  // Values that match no declared option (stale data) keep their own columns
  // rather than disappearing.
  for (const [key, bucket] of buckets) {
    if (key === null) continue;
    columns.push({ key, label: key, items: bucket });
  }
  columns.push({ key: null, label: 'No value', items: buckets.get(null) ?? [] });

  return columns;
}
