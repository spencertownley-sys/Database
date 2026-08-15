/**
 * The typed API client. Every fetch in the app goes through here.
 *
 * The app calls `/api/v1` — the same routes customers do, speaking the same
 * wire format: snake_case bodies and params, the `X-Workspace-Id` header, the
 * `{ data, meta }` collection envelope. The camel↔snake conversion happens
 * here and in the route layer, and nowhere else — components stay camelCase,
 * the wire stays spec-shaped, and "the published spec is the app's own API"
 * stays a testable claim rather than an aspiration.
 */

import type { Item } from '@/server/db/schema/items';
import type { ChangeOperation, ChangeSetStatus, ChangeSummary, SampleEntry } from '@/server/db/schema/changeSets';
import type { Field, FieldGroup, ItemType } from '@/server/db/schema/itemTypes';
import type { ErrorCode } from '@/server/lib/errors';
import type { FilterGroup, SortSpec } from '@/types/filters';
import { fromWire, toWire } from '@/lib/wire';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;
  readonly requestId?: string;

  constructor(
    status: number,
    body: {
      error: {
        code: ErrorCode;
        message: string;
        details?: Record<string, unknown>;
        request_id?: string;
      };
    },
  ) {
    super(body.error.message);
    this.name = 'ApiError';
    this.code = body.error.code;
    this.status = status;
    this.details = body.error.details;
    this.requestId = body.error.request_id;
  }
}

export interface ItemTypeWithSchema extends ItemType {
  fields: Field[];
  fieldGroups: FieldGroup[];
}

export interface CollectionMeta {
  cursor: string | null;
  hasMore: boolean;
  total: number | null;
}

export interface Collection<T> {
  data: T[];
  meta: CollectionMeta;
}

/** The §5 change-set wire shape, camelCased by the client boundary. */
export interface ChangeSetWire {
  id: string;
  status: ChangeSetStatus;
  operation: ChangeOperation;
  itemCount: number;
  skippedCount: number;
  skipped: Array<{ itemId: string | null; reason: string }>;
  summary: ChangeSummary;
  samples: SampleEntry[];
  expiresAt: string | null;
  committedAt: string | null;
  undoAvailableUntil: string | null;
  requiresAsyncCommit?: boolean;
  committed?: boolean;
  appliedCount?: number;
  variantsPropagated?: number;
  message?: string;
  entries?: SampleEntry[];
  truncated?: boolean;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
  /** Sent as `Idempotency-Key`; honoured on preview and commit. */
  idempotencyKey?: string;
}

let workspaceId: string | null = null;

/** Set once by the workspace shell so callers do not thread the id through. */
export function setWorkspaceId(id: string): void {
  workspaceId = id;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (workspaceId) headers['x-workspace-id'] = workspaceId;
  if (options.idempotencyKey) headers['idempotency-key'] = options.idempotencyKey;

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(toWire(options.body)),
    signal: options.signal,
    credentials: 'same-origin',
  });

  const text = await response.text();
  const parsed: unknown = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      parsed as ConstructorParameters<typeof ApiError>[1],
    );
  }
  return fromWire(parsed) as T;
}

export interface ListItemsParams {
  itemTypeId?: string;
  filter?: FilterGroup;
  sort?: SortSpec[];
  q?: string;
  fields?: string[];
  expand?: string[];
  parentId?: string;
  inSubtree?: string;
  treeNodeId?: string;
  includeDescendants?: boolean;
  variantParentId?: string;
  includeVariants?: boolean;
  incompleteOnly?: boolean;
  limit?: number;
  cursor?: string;
}

/** Spec-named query params (§4): snake_case keys, `sort` as `key:dir,key:dir`. */
function toQuery(params: ListItemsParams): string {
  const search = new URLSearchParams();
  if (params.itemTypeId) search.set('item_type_id', params.itemTypeId);
  if (params.filter) search.set('filter', JSON.stringify(params.filter));
  if (params.sort?.length) {
    search.set('sort', params.sort.map((s) => `${s.field}:${s.direction}`).join(','));
  }
  if (params.q) search.set('q', params.q);
  if (params.fields?.length) search.set('fields', params.fields.join(','));
  if (params.expand?.length) search.set('expand', params.expand.join(','));
  if (params.parentId) search.set('parent_id', params.parentId);
  if (params.inSubtree) search.set('in_subtree', params.inSubtree);
  if (params.treeNodeId) search.set('tree_node_id', params.treeNodeId);
  if (params.includeDescendants !== undefined) {
    search.set('include_descendants', String(params.includeDescendants));
  }
  if (params.variantParentId) search.set('variant_parent_id', params.variantParentId);
  if (params.includeVariants !== undefined) {
    search.set('include_variants', String(params.includeVariants));
  }
  if (params.incompleteOnly) search.set('incomplete_only', 'true');
  if (params.limit) search.set('limit', String(params.limit));
  if (params.cursor) search.set('cursor', params.cursor);
  return search.toString();
}

export const api = {
  itemTypes: {
    list: (signal?: AbortSignal) =>
      request<Collection<ItemTypeWithSchema>>(
        '/api/v1/item-types?expand=fields,field_groups',
        { signal },
      ),
    create: (body: { name: string; presetKey?: string; key?: string; description?: string }) =>
      request<ItemTypeWithSchema>('/api/v1/item-types', { method: 'POST', body }),
  },

  items: {
    list: (params: ListItemsParams, signal?: AbortSignal) =>
      request<Collection<Item>>(`/api/v1/items?${toQuery(params)}`, { signal }),
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
      request<ChangeSetWire>('/api/v1/change-sets', {
        method: 'POST',
        body,
        idempotencyKey,
      }),

    get: (id: string, entries: 'sample' | 'all' = 'sample') =>
      request<ChangeSetWire>(
        `/api/v1/change-sets/${id}${entries === 'all' ? '?entries=all' : ''}`,
      ),

    commit: (id: string, idempotencyKey?: string) =>
      request<ChangeSetWire>(`/api/v1/change-sets/${id}/commit`, {
        method: 'POST',
        idempotencyKey,
      }),

    undo: (id: string) =>
      request<{
        undoChangeSetId: string;
        originalChangeSetId: string;
        status: ChangeSetStatus;
        itemCount: number;
        restored: number;
        variantsPropagated: number;
      }>(`/api/v1/change-sets/${id}/undo`, { method: 'POST' }),

    discard: (id: string) =>
      request<{ discarded: true }>(`/api/v1/change-sets/${id}`, { method: 'DELETE' }),
  },
};
