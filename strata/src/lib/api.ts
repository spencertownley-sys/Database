/**
 * The typed API client. Every fetch in the app goes through here.
 *
 * The app calls `/api/v1` — the same routes customers do. There is no internal
 * endpoint with different validation or a shortcut around the change-set write
 * path, which is what makes "the published spec is the app's own API" a
 * testable claim rather than an aspiration.
 */

import type { Item } from '@/server/db/schema/items';
import type { ChangeSet, ChangeOperation, SampleEntry } from '@/server/db/schema/changeSets';
import type { Field, FieldGroup, ItemType } from '@/server/db/schema/itemTypes';
import type { ErrorCode } from '@/server/lib/errors';
import type { FilterGroup, SortSpec } from '@/types/filters';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, body: { error: { code: ErrorCode; message: string; details?: unknown; requestId?: string } }) {
    super(body.error.message);
    this.name = 'ApiError';
    this.code = body.error.code;
    this.status = status;
    this.details = body.error.details;
    this.requestId = body.error.requestId;
  }
}

export interface ItemTypeWithSchema extends ItemType {
  fields: Field[];
  groups: FieldGroup[];
}

export interface ListItemsResult {
  items: Item[];
  nextCursor: string | null;
  total: number | null;
}

export interface ChangeSetResult {
  changeSet: ChangeSet;
  requiresAsyncCommit: boolean;
  committed?: boolean;
  appliedCount?: number;
  skippedCount?: number;
  variantsPropagated?: number;
  message?: string;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Sent as `Idempotency-Key`; honoured on preview and commit. */
  idempotencyKey?: string;
}

let workspaceSlug: string | null = null;

/** Set once by the workspace shell so callers do not thread the slug through. */
export function setWorkspaceSlug(slug: string): void {
  workspaceSlug = slug;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // `URL` needs an absolute base to parse a relative path. The base is only
  // ever a parsing scaffold — the request goes out same-origin using
  // `pathname + search`. Stripping the base by string replacement instead
  // silently mangles the URL whenever the real origin happens to share its
  // prefix, which is every local development session.
  const parseBase =
    typeof window === 'undefined' ? 'http://strata.invalid' : window.location.origin;
  const url = new URL(path, parseBase);
  if (workspaceSlug && !url.searchParams.has('workspace')) {
    url.searchParams.set('workspace', workspaceSlug);
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  const response = await fetch(`${url.pathname}${url.search}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
    credentials: 'same-origin',
  });

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      parsed as { error: { code: ErrorCode; message: string; details?: unknown; requestId?: string } },
    );
  }
  return parsed as T;
}

export interface ListItemsParams {
  itemType?: string;
  filter?: FilterGroup;
  sort?: SortSpec[];
  search?: string;
  under?: string;
  treeNode?: string;
  treeIncludeDescendants?: boolean;
  incompleteOnly?: boolean;
  includeVariants?: boolean;
  limit?: number;
  cursor?: string;
  withTotal?: boolean;
}

function toQuery(params: ListItemsParams): string {
  const search = new URLSearchParams();
  if (params.itemType) search.set('itemType', params.itemType);
  if (params.filter) search.set('filter', JSON.stringify(params.filter));
  if (params.sort?.length) search.set('sort', JSON.stringify(params.sort));
  if (params.search) search.set('search', params.search);
  if (params.under) search.set('under', params.under);
  if (params.treeNode) search.set('treeNode', params.treeNode);
  if (params.treeIncludeDescendants) search.set('treeIncludeDescendants', 'true');
  if (params.incompleteOnly) search.set('incompleteOnly', 'true');
  if (params.includeVariants) search.set('includeVariants', 'true');
  if (params.limit) search.set('limit', String(params.limit));
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.withTotal) search.set('withTotal', 'true');
  return search.toString();
}

export const api = {
  itemTypes: {
    list: (signal?: AbortSignal) =>
      request<{ itemTypes: ItemTypeWithSchema[] }>('/api/v1/item-types', { signal }),
    create: (body: { name: string; presetKey?: string; key?: string; description?: string }) =>
      request<{ itemType: ItemTypeWithSchema }>('/api/v1/item-types', { method: 'POST', body }),
  },

  items: {
    list: (params: ListItemsParams, signal?: AbortSignal) =>
      request<ListItemsResult>(`/api/v1/items?${toQuery(params)}`, { signal }),
  },

  changeSets: {
    /** Creates a preview. `autoCommit` is the single-cell path. */
    create: (
      body: {
        operation: ChangeOperation;
        itemTypeId?: string;
        target: Record<string, unknown>;
        patch?: Record<string, unknown>;
        autoCommit?: boolean;
      },
      idempotencyKey?: string,
    ) =>
      request<ChangeSetResult>('/api/v1/change-sets', {
        method: 'POST',
        body,
        idempotencyKey,
      }),

    get: (id: string, entries: 'sample' | 'all' = 'sample') =>
      request<{ changeSet: ChangeSet; entries: SampleEntry[]; truncated: boolean }>(
        `/api/v1/change-sets/${id}${entries === 'all' ? '?entries=all' : ''}`,
      ),

    commit: (id: string, idempotencyKey?: string) =>
      request<{
        changeSet: ChangeSet;
        appliedCount: number;
        skippedCount: number;
        variantsPropagated: number;
      }>(`/api/v1/change-sets/${id}/commit`, { method: 'POST', idempotencyKey }),

    undo: (id: string) =>
      request<{ changeSet: ChangeSet; restoredCount: number }>(
        `/api/v1/change-sets/${id}/undo`,
        { method: 'POST' },
      ),

    discard: (id: string) =>
      request<{ discarded: true }>(`/api/v1/change-sets/${id}`, { method: 'DELETE' }),
  },
};
