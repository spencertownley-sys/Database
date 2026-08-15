/**
 * The filter AST shared by the grid, saved views, exports, and `/api/v1`.
 *
 * A `FilterGroup` is a boolean tree; leaves are `FilterClause`s naming a
 * *field key* (never a column name, never a `field_id` the client guessed).
 * `src/server/search/filterCompiler.ts` resolves keys against the Item Type's
 * schema and emits parameterized SQL. That resolution step is the security
 * boundary: it is why a filter can never name a column that does not belong
 * to the caller's workspace.
 */

export type LogicalOperator = 'and' | 'or';

export const TEXT_OPERATORS = [
  'eq',
  'neq',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'in',
  'not_in',
  'is_empty',
  'is_not_empty',
] as const;

export const NUMBER_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'between',
  'is_empty',
  'is_not_empty',
] as const;

export const DATE_OPERATORS = [
  'eq',
  'neq',
  'before',
  'after',
  'on_or_before',
  'on_or_after',
  'between',
  'in_last_days',
  'in_next_days',
  'is_empty',
  'is_not_empty',
] as const;

export const BOOL_OPERATORS = ['is_true', 'is_false', 'is_empty', 'is_not_empty'] as const;

export const UUID_OPERATORS = ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'] as const;

export const ARRAY_OPERATORS = [
  'has_any',
  'has_all',
  'has_none',
  'is_empty',
  'is_not_empty',
] as const;

export const FILTER_OPERATORS = [
  ...new Set<string>([
    ...TEXT_OPERATORS,
    ...NUMBER_OPERATORS,
    ...DATE_OPERATORS,
    ...BOOL_OPERATORS,
    ...UUID_OPERATORS,
    ...ARRAY_OPERATORS,
  ]),
] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

/** Operators that take no value — everything else requires one. */
export const NULLARY_OPERATORS: ReadonlySet<string> = new Set([
  'is_empty',
  'is_not_empty',
  'is_true',
  'is_false',
]);

/** Operators taking a two-element tuple. */
export const BINARY_OPERATORS: ReadonlySet<string> = new Set(['between']);

/** Operators taking a list. */
export const LIST_OPERATORS: ReadonlySet<string> = new Set([
  'in',
  'not_in',
  'has_any',
  'has_all',
  'has_none',
]);

/**
 * System columns addressable in a filter alongside user field keys. Prefixed
 * so a user field named `title` can never collide with the built-in one.
 */
export const SYSTEM_FIELD_KEYS = [
  '$title',
  '$created_at',
  '$updated_at',
  '$completeness_pct',
  '$item_type_id',
  '$parent_id',
  '$path',
  '$tree_node_id',
  '$assignee_id',
  '$is_variant',
  '$has_invalid_values',
] as const;

export type SystemFieldKey = (typeof SYSTEM_FIELD_KEYS)[number];

export function isSystemFieldKey(key: string): key is SystemFieldKey {
  return (SYSTEM_FIELD_KEYS as readonly string[]).includes(key);
}

export interface FilterClause {
  /** A user field `key`, or one of `SYSTEM_FIELD_KEYS`. Never a column name. */
  field: string;
  operator: FilterOperator;
  /** Absent for nullary operators; a tuple for `between`; a list for `in`. */
  value?: unknown;
  /**
   * For `$tree_node_id` only: match the node's whole subtree rather than the
   * node itself. Ignored for every other field.
   */
  includeDescendants?: boolean;
}

export interface FilterGroup {
  operator: LogicalOperator;
  clauses: Array<FilterClause | FilterGroup>;
}

export function isFilterGroup(node: FilterClause | FilterGroup): node is FilterGroup {
  return 'clauses' in node;
}

export const EMPTY_FILTER: FilterGroup = { operator: 'and', clauses: [] };

export type SortDirection = 'asc' | 'desc';

export interface SortSpec {
  field: string;
  direction: SortDirection;
  /** Postgres default puts NULLs last on ASC; views may override. */
  nulls?: 'first' | 'last';
}

export interface GroupSpec {
  field: string;
  direction: SortDirection;
  collapsed?: string[];
}

/**
 * Keyset pagination cursor. OFFSET is never used: at 100k items an OFFSET
 * scan re-reads every skipped row and the deep pages fall off the perf budget.
 */
export interface Cursor {
  /** Opaque, base64url of the sort tuple plus the tiebreaker id. */
  after?: string;
  limit: number;
}

export interface QuerySpec {
  itemTypeId?: string;
  filter?: FilterGroup;
  sort?: SortSpec[];
  group?: GroupSpec;
  search?: string;
  cursor?: Cursor;
  /** Restricts to a work-hierarchy subtree. */
  underItemId?: string;
  /** Convenience for the "incomplete only" toggle. */
  incompleteOnly?: boolean;
}
