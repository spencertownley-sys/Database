'use client';

/**
 * List view — the familiar on-ramp for Monday/ClickUp switchers, and the best
 * surface for *reading* the work hierarchy (UI/UX §3.7).
 *
 * Rows nest by indentation with expander chevrons. The hierarchy is assembled
 * client-side from the loaded page's `parent_id`s: a parent whose children are
 * on a later page simply renders flat, which is the honest behaviour for a
 * paged list. Inline editing covers the title (the primary field); everything
 * richer belongs to the grid or the detail panel.
 */

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Item } from '@/server/db/schema/items';
import type { Field } from '@/server/db/schema/itemTypes';
import { api, ApiError } from '@/lib/api';
import { formatValue } from '@/server/validation/fieldTypes';
import { CompletenessBar } from '@/components/item-detail/CompletenessBar';

export interface ListViewProps {
  items: Item[];
  fields: Field[];
  onOpenDetail: (itemId: string) => void;
  onDataChanged: () => void;
  onToast: (toast: { message: string; tone?: 'info' | 'error'; undo?: () => void }) => void;
}

interface ListRow {
  item: Item;
  depth: number;
  hasChildren: boolean;
}

export function ListView(props: ListViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  // The first three non-title fields are the "primary fields" a list shows.
  const primaryFields = props.fields.slice(0, 3);

  const rows = useMemo(() => buildRows(props.items, collapsed), [props.items, collapsed]);

  const toggle = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const commitTitle = async (item: Item) => {
    const title = draft.trim();
    setEditingId(null);
    if (!title || title === item.title) return;
    try {
      await api.items.patch(item.id, { title });
      props.onDataChanged();
    } catch (error) {
      props.onToast({
        message: error instanceof ApiError ? error.message : 'Could not rename that item.',
        tone: 'error',
      });
    }
  };

  return (
    <div className="h-full overflow-auto" role="list" aria-label="Item list">
      {rows.map(({ item, depth, hasChildren }) => (
        <div
          key={item.id}
          role="listitem"
          className="group flex h-10 items-center gap-2 border-b border-[var(--color-border)] px-3 text-sm hover:bg-[var(--color-muted)]"
        >
          <span style={{ width: depth * 20 }} aria-hidden />
          {hasChildren ? (
            <button
              type="button"
              aria-expanded={!collapsed.has(item.id)}
              aria-label={collapsed.has(item.id) ? 'Expand' : 'Collapse'}
              className="rounded p-0.5 text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)]"
              onClick={() => toggle(item.id)}
            >
              {collapsed.has(item.id) ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          ) : (
            <span className="w-[18px]" aria-hidden />
          )}

          {editingId === item.id ? (
            <input
              autoFocus
              className="min-w-0 flex-1 rounded border border-[var(--color-accent)] px-1.5 py-0.5 text-sm outline-none"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commitTitle(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void commitTitle(item);
                if (e.key === 'Escape') setEditingId(null);
              }}
            />
          ) : (
            <button
              type="button"
              className="min-w-0 flex-1 truncate text-left font-medium hover:underline"
              onClick={() => props.onOpenDetail(item.id)}
              onDoubleClick={() => {
                setEditingId(item.id);
                setDraft(item.title);
              }}
              title={item.title}
            >
              {item.title || <span className="text-[var(--color-ink-subtle)]">Untitled</span>}
            </button>
          )}

          {primaryFields.map((field) => (
            <span
              key={field.key}
              className="hidden w-36 truncate text-[var(--color-ink-muted)] md:inline"
              title={field.label}
            >
              {formatValue(field.type, item.effectiveValues[field.key], field.config)}
            </span>
          ))}

          <span className="w-24 shrink-0">
            <CompletenessBar pct={item.completenessPct} />
          </span>
        </div>
      ))}
      {rows.length === 0 && (
        <p className="p-6 text-sm text-[var(--color-ink-subtle)]">No items match this view.</p>
      )}
    </div>
  );
}

/** Depth-first ordering from the loaded page, respecting collapse state. */
function buildRows(items: readonly Item[], collapsed: ReadonlySet<string>): ListRow[] {
  const byParent = new Map<string | null, Item[]>();
  const loaded = new Set(items.map((i) => i.id));

  for (const item of items) {
    // Variants nest under their model exactly like children under a parent
    // (UI/UX §9.4). A parent that is not in this page renders its child at the
    // root — a gap in the page must not hide rows.
    const nestKey = item.variantParentId ?? item.parentId;
    const parentKey = nestKey && loaded.has(nestKey) ? nestKey : null;
    const list = byParent.get(parentKey);
    if (list) list.push(item);
    else byParent.set(parentKey, [item]);
  }

  const rows: ListRow[] = [];
  const walk = (parentKey: string | null, depth: number) => {
    for (const item of byParent.get(parentKey) ?? []) {
      const hasChildren = byParent.has(item.id);
      rows.push({ item, depth, hasChildren });
      if (hasChildren && !collapsed.has(item.id)) walk(item.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}
