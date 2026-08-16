'use client';

/**
 * The workspace activity feed (Step 13) — every committed change set, newest
 * first, filterable by person and operation. Each row is a change set, which
 * is also the undo unit: history and undo cannot drift because they are the
 * same rows.
 */

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { api, setWorkspaceId, type ActivityEntry } from '@/lib/api';
import type { WorkspaceMemberOption } from '@/components/grid/editors/UserEditor';

const OPERATIONS = [
  'create',
  'set_field',
  'clear_field',
  'change_type',
  'reparent',
  'tree_assign',
  'tree_unassign',
  'delete',
  'assign_user',
  'variant_propagate',
] as const;

export function ActivityPage(props: { workspaceId: string; members: WorkspaceMemberOption[] }) {
  setWorkspaceId(props.workspaceId);

  const [actorId, setActorId] = useState('');
  const [operation, setOperation] = useState('');

  const { data, fetchNextPage, hasNextPage, isFetching } = useInfiniteQuery({
    queryKey: ['activity', props.workspaceId, actorId, operation],
    queryFn: ({ pageParam, signal }) =>
      api.activity.list(
        {
          actorId: actorId || undefined,
          operation: operation || undefined,
          cursor: pageParam || undefined,
          limit: 50,
        },
        signal,
      ),
    initialPageParam: '',
    getNextPageParam: (last) => last.meta.cursor ?? undefined,
  });

  const entries = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div className="mx-auto h-full max-w-3xl overflow-y-auto px-6 py-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="text-lg font-semibold">Activity</h1>
        <select
          aria-label="Filter by person"
          className="ml-auto rounded border bg-[var(--color-surface)] px-2 py-1 text-xs"
          value={actorId}
          onChange={(e) => setActorId(e.target.value)}
        >
          <option value="">Everyone</option>
          {props.members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name ?? m.email}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by operation"
          className="rounded border bg-[var(--color-surface)] px-2 py-1 text-xs"
          value={operation}
          onChange={(e) => setOperation(e.target.value)}
        >
          <option value="">All operations</option>
          {OPERATIONS.map((op) => (
            <option key={op} value={op}>
              {op.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </header>

      {entries.length === 0 && !isFetching ? (
        <p className="rounded border border-dashed p-8 text-center text-sm text-[var(--color-ink-subtle)]">
          Nothing here yet. Every edit, import, and bulk change lands in this feed the moment it
          commits — and can be undone from where it happened for 24 hours.
        </p>
      ) : (
        <ol className="space-y-0">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-baseline gap-3 border-b py-2 text-sm">
              <span className="w-36 shrink-0 truncate font-medium">
                {entry.actorName ?? (entry.source === 'api' ? 'API' : 'System')}
              </span>
              <span className="min-w-0 flex-1">
                {describe(entry)}
                {entry.undoneByChangeSetId && (
                  <span className="ml-1.5 rounded bg-[var(--color-muted)] px-1.5 py-0.5 text-[11px] text-[var(--color-ink-muted)]">
                    undone
                  </span>
                )}
              </span>
              <time
                className="shrink-0 text-xs text-[var(--color-ink-subtle)]"
                dateTime={entry.createdAt}
              >
                {new Date(entry.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ol>
      )}

      {hasNextPage && (
        <button
          type="button"
          className="mt-4 w-full rounded border py-1.5 text-sm hover:bg-[var(--color-muted)]"
          disabled={isFetching}
          onClick={() => void fetchNextPage()}
        >
          {isFetching ? 'Loading…' : 'Load older activity'}
        </button>
      )}
    </div>
  );
}

function describe(entry: ActivityEntry): string {
  const n = entry.itemCount;
  const items = `${n.toLocaleString()} item${n === 1 ? '' : 's'}`;
  switch (entry.operation) {
    case 'create':
      return `created ${items}`;
    case 'delete':
      return `archived ${items}`;
    case 'set_field':
    case 'clear_field':
      return `edited ${items}`;
    case 'change_type':
      return `changed the type of ${items}`;
    case 'reparent':
      return `moved ${items}`;
    case 'tree_assign':
      return `filed ${items} into categories`;
    case 'tree_unassign':
      return `removed ${items} from categories`;
    case 'assign_user':
      return `assigned ${items}`;
    case 'variant_propagate':
      return `propagated model changes to ${items}`;
    default:
      return `changed ${items}`;
  }
}
