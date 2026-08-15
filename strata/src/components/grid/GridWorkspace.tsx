'use client';

/**
 * Wires the grid to the API.
 *
 * Reads go through TanStack Query keyed on `[workspace, itemType, viewHash]`,
 * so changing a sort or a filter is a new cache entry rather than a mutation of
 * the current one — which is what lets switching back to a previous view render
 * instantly from cache while it revalidates.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Field } from '@/server/db/schema/itemTypes';
import { api, setWorkspaceId, type ItemTypeWithSchema } from '@/lib/api';
import type { SortSpec } from '@/types/filters';
import { Grid } from './Grid';
import { SavedViews } from './SavedViews';
import { ConceptHint } from '@/components/concept-hints/ConceptHint';
import { ListView } from '@/components/list/ListView';
import { BoardView } from '@/components/board/BoardView';
import { ItemDetailPanel } from '@/components/item-detail/ItemDetailPanel';
import type { WorkspaceMemberOption } from './editors/UserEditor';

type ViewType = 'grid' | 'list' | 'board';

export interface GridWorkspaceProps {
  workspaceSlug: string;
  /** Sent as `X-Workspace-Id` on every API call (API Design §1.1). */
  workspaceId: string;
  itemType: ItemTypeWithSchema;
  members: WorkspaceMemberOption[];
  editableFieldKeys: string[] | null;
}

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'error';
  ttlMs?: number;
  undo?: () => void;
}

export function GridWorkspace(props: GridWorkspaceProps) {
  const queryClient = useQueryClient();
  const [sort, setSort] = useState<SortSpec[]>([{ field: '$title', direction: 'asc' }]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [pinnedFieldKeys, setPinnedFieldKeys] = useState<string[]>([]);
  const [fieldOrder, setFieldOrder] = useState<string[] | undefined>(undefined);
  const [incompleteOnly, setIncompleteOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Switching view type preserves filters and sort (UI/UX §3.3): the three
  // views render the same query state, so the switch is purely presentational.
  const [viewType, setViewType] = useState<ViewType>('grid');
  const [boardGroupFieldKey, setBoardGroupFieldKey] = useState<string | null>(null);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // During render, not in an effect — an effect would race the first queries.
  setWorkspaceId(props.workspaceId);

  const viewHash = useMemo(
    () => JSON.stringify({ sort, incompleteOnly, search }),
    [sort, incompleteOnly, search],
  );

  const queryKey = useMemo(
    () => ['items', props.workspaceSlug, props.itemType.id, viewHash],
    [props.workspaceSlug, props.itemType.id, viewHash],
  );

  const { data, isLoading, error } = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      api.items.list(
        {
          itemTypeId: props.itemType.id,
          sort,
          incompleteOnly: incompleteOnly || undefined,
          q: search || undefined,
          limit: 200,
        },
        signal,
      ),
  });

  const pushToast = useCallback((toast: { message: string; undo?: () => void; tone?: 'info' | 'error' }) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    // UI/UX §3.4: the undo toast persists for 60 seconds with a draining
    // progress line; the change stays undoable from the activity feed for 24h.
    const ttl = toast.undo ? 60_000 : 5_000;
    setToasts((current) => [
      ...current.slice(-2),
      { id, tone: toast.tone ?? 'info', ttlMs: ttl, ...toast },
    ]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), ttl);
  }, []);

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['items', props.workspaceSlug] });
  }, [props.workspaceSlug, queryClient]);

  const fields: Field[] = props.itemType.fields;
  const items = data?.data ?? [];

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-[var(--color-surface)] px-3">
        <h1 className="text-sm font-semibold">{props.itemType.pluralLabel ?? props.itemType.label}</h1>

        <nav aria-label="View type" className="ml-2 flex rounded-[var(--radius-md)] border p-0.5">
          {(['grid', 'list', 'board'] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={viewType === kind}
              className={`rounded px-2 py-0.5 text-xs capitalize ${
                viewType === kind
                  ? 'bg-[var(--color-accent)] text-white'
                  : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-muted)]'
              }`}
              onClick={() => setViewType(kind)}
            >
              {kind}
            </button>
          ))}
        </nav>
        <SavedViews
          itemTypeId={props.itemType.id}
          currentType={viewType}
          currentConfig={() => ({
            sort,
            search: search || undefined,
            incompleteOnly: incompleteOnly || undefined,
            columnWidths: Object.keys(columnWidths).length ? columnWidths : undefined,
            pinnedFieldKeys: pinnedFieldKeys.length ? pinnedFieldKeys : undefined,
            visibleFieldKeys: fieldOrder,
            boardGroupFieldKey: boardGroupFieldKey ?? undefined,
          })}
          onApply={(view) => {
            setViewType(view.type);
            setSort(view.config.sort ?? [{ field: '$title', direction: 'asc' }]);
            setSearch(view.config.search ?? '');
            setIncompleteOnly(view.config.incompleteOnly ?? false);
            setColumnWidths(view.config.columnWidths ?? {});
            setPinnedFieldKeys(view.config.pinnedFieldKeys ?? []);
            setFieldOrder(view.config.visibleFieldKeys);
            setBoardGroupFieldKey(view.config.boardGroupFieldKey ?? null);
          }}
        />

        <span className="text-xs text-[var(--color-ink-subtle)]">
          {data?.meta.total != null ? `${data.meta.total} total` : ''}
        </span>

        <input
          ref={searchRef}
          className="ml-3 w-56 rounded-[var(--radius-md)] border px-2 py-1 text-sm outline-none focus:border-[var(--color-accent)]"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search items"
        />

        <label className="ml-2 flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
          <input
            type="checkbox"
            checked={incompleteOnly}
            onChange={(e) => setIncompleteOnly(e.target.checked)}
          />
          Incomplete only
        </label>

        <button
          type="button"
          className="ml-auto rounded border px-2 py-1 text-xs hover:bg-[var(--color-muted)]"
          title="Export the current view as CSV — same filters, same sort"
          onClick={() => {
            void api.exports
              .create({
                itemTypeId: props.itemType.id,
                sort,
                search: search || undefined,
                incompleteOnly: incompleteOnly || undefined,
              })
              .then((result) => {
                window.location.assign(result.downloadUrl);
              })
              .catch(() => {
                /* the toolbar is not the place for an error panel; retry works */
              });
          }}
        >
          Export CSV
        </button>
      </div>

      {incompleteOnly && (
        <div className="shrink-0 px-3 pt-2">
          <ConceptHint hint="completeness" />
        </div>
      )}

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <p className="p-6 text-sm text-[var(--color-ink-subtle)]">Loading items…</p>
        ) : error ? (
          <p className="p-6 text-sm text-[var(--color-danger)]">
            {error instanceof Error ? error.message : 'Could not load items.'}
          </p>
        ) : items.length === 0 ? (
          <EmptyState typeName={props.itemType.label} incompleteOnly={incompleteOnly} />
        ) : viewType === 'list' ? (
          <ListView
            items={items}
            fields={fields}
            onOpenDetail={setDetailItemId}
            onDataChanged={refetch}
            onToast={pushToast}
          />
        ) : viewType === 'board' ? (
          <BoardView
            items={items}
            fields={fields}
            itemTypeId={props.itemType.id}
            members={props.members}
            groupFieldKey={boardGroupFieldKey}
            onGroupFieldChange={setBoardGroupFieldKey}
            onOpenDetail={setDetailItemId}
            onDataChanged={refetch}
            onToast={pushToast}
          />
        ) : (
          <Grid
            items={items}
            fields={fields}
            itemTypeId={props.itemType.id}
            members={props.members}
            sort={sort}
            columnWidths={columnWidths}
            pinnedFieldKeys={pinnedFieldKeys}
            visibleFieldKeys={fieldOrder}
            editableFieldKeys={props.editableFieldKeys}
            onSortChange={setSort}
            onColumnWidthChange={setColumnWidths}
            onPinnedChange={setPinnedFieldKeys}
            onFieldOrderChange={setFieldOrder}
            onOpenDetail={setDetailItemId}
            onFocusFilter={() => searchRef.current?.focus()}
            onCommandPalette={() =>
              window.dispatchEvent(new Event('strata:open-command-palette'))
            }
            onDataChanged={refetch}
            onToast={pushToast}
          />
        )}

        {detailItemId && (
          <ItemDetailPanel
            itemId={detailItemId}
            fields={fields}
            fieldGroups={props.itemType.fieldGroups}
            members={props.members}
            onClose={() => setDetailItemId(null)}
            onDataChanged={refetch}
          />
        )}
      </div>

      <div className="pointer-events-none fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            aria-live="polite"
            className={`pointer-events-auto relative flex items-center gap-3 overflow-hidden rounded-[var(--radius-md)] px-3 py-2 text-sm shadow-lg ${
              toast.tone === 'error'
                ? 'bg-[var(--color-danger)] text-white'
                : 'bg-[var(--color-ink)] text-white'
            }`}
          >
            <span>{toast.message}</span>
            {toast.undo && (
              <button
                type="button"
                className="rounded px-2 py-0.5 font-medium underline underline-offset-2"
                onClick={() => {
                  toast.undo?.();
                  setToasts((current) => current.filter((t) => t.id !== toast.id));
                }}
              >
                Undo
              </button>
            )}
            {toast.undo && (
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-0.5 origin-left bg-white/50 motion-safe:animate-[toast-drain_linear_forwards]"
                style={{ animationDuration: `${toast.ttlMs ?? 60_000}ms` }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Empty states teach the concept rather than just offering a button. */
function EmptyState({ typeName, incompleteOnly }: { typeName: string; incompleteOnly: boolean }) {
  if (incompleteOnly) {
    return (
      <div className="mx-auto max-w-md p-10 text-center">
        <p className="text-sm font-medium">Everything here is complete.</p>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Completeness counts the required fields on each item, so an empty result means every{' '}
          {typeName.toLowerCase()} has all of them filled in.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md p-10 text-center">
      <p className="text-sm font-medium">No {typeName.toLowerCase()} items yet.</p>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        Items of this type can nest inside one another, so a phase of work and the work itself are
        the same kind of thing — you do not need a separate type for each level.
      </p>
    </div>
  );
}
