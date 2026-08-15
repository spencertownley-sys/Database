/**
 * The search boundary.
 *
 * Postgres is the v1 implementation and is expected to carry the product well
 * past launch — trigram search plus a typed projection index handles 100k
 * items per workspace comfortably. This interface exists so that when a
 * workspace eventually outgrows it, the replacement is a new class rather than
 * a rewrite of every caller: nothing outside `src/server/search/` issues a
 * query against `item_field_index` directly.
 *
 * The interface is deliberately narrow. Anything richer (facets, relevance
 * tuning, typo tolerance) would be a promise Postgres cannot keep, and a
 * capability the app used would become the thing blocking the swap.
 */

import type { Tx } from '@/server/db';
import type { Field } from '@/server/db/schema/itemTypes';
import type { Item } from '@/server/db/schema/items';
import type { FilterGroup, GroupSpec, SortSpec } from '@/types/filters';

export interface SearchQuery {
  itemTypeId?: string;
  filter?: FilterGroup;
  sort?: SortSpec[];
  search?: string;
  /** Restrict to a work-hierarchy subtree, inclusive of the root. */
  underItemId?: string;
  /** Restrict to a category tree node. */
  treeNodeId?: string;
  treeIncludeDescendants?: boolean;
  incompleteOnly?: boolean;
  /** Variants are hidden by default; the grid shows them under their model. */
  includeVariants?: boolean;
  limit: number;
  /** Opaque keyset cursor from a previous page. */
  cursor?: string;
}

export interface SearchPage {
  items: Item[];
  /** Absent when this is the last page. */
  nextCursor?: string;
  /** Only computed when `withTotal` is requested — it costs a second scan. */
  total?: number;
}

export interface GroupBucket {
  /** Option id, user id, or raw value; `null` for the "no value" bucket. */
  key: string | null;
  count: number;
  /** Aggregates the grid renders in the group header. */
  sum?: number;
  avg?: number;
  avgCompleteness: number;
}

export interface SearchProvider {
  search(
    tx: Tx,
    workspaceId: string,
    fields: readonly Field[],
    query: SearchQuery,
    opts?: { withTotal?: boolean },
  ): Promise<SearchPage>;

  count(
    tx: Tx,
    workspaceId: string,
    fields: readonly Field[],
    query: Omit<SearchQuery, 'limit' | 'cursor'>,
  ): Promise<number>;

  groupCounts(
    tx: Tx,
    workspaceId: string,
    fields: readonly Field[],
    query: Omit<SearchQuery, 'limit' | 'cursor'>,
    group: GroupSpec,
    aggregateFieldKey?: string,
  ): Promise<GroupBucket[]>;

  /** Every matching id, for a filter-targeted change set. Bounded by `max`. */
  resolveIds(
    tx: Tx,
    workspaceId: string,
    fields: readonly Field[],
    query: Omit<SearchQuery, 'limit' | 'cursor'>,
    max: number,
  ): Promise<string[]>;
}
