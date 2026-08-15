/**
 * Compiles a `FilterGroup` AST into parameterized SQL.
 *
 * Approach: user fields are matched with `EXISTS` subqueries against
 * `item_field_index`, one per clause. That shape is what lets each predicate
 * use a partial index on the typed value column — a JSONB probe on
 * `items.values` would read every candidate row and filter afterwards, which
 * misses the performance budget at 100k items by an order of magnitude.
 *
 * **There is no string concatenation path in this file, and that is the
 * point.** Everything a caller supplies arrives as a bound parameter:
 *
 *   - Field *keys* are resolved against the Item Type's own schema, producing
 *     a `field_id` we looked up ourselves. A key that does not resolve is an
 *     error, never a passthrough — so a caller cannot name a column, a table,
 *     or a field belonging to another workspace.
 *   - Operators are matched against a closed union and dispatched through a
 *     switch. An unknown operator throws.
 *   - Values are interpolated through drizzle's `sql` template, which binds
 *     them. `LIKE` patterns escape `%`, `_`, and `\` before binding.
 *
 * An ESLint rule fails the build on `+` concatenation or `Array.join()` inside
 * a `sql` template anywhere in the codebase. If you find yourself needing one
 * here, the answer is another parameter, not an exception.
 */

import { sql, type SQL } from 'drizzle-orm';
import type { Field } from '@/server/db/schema/itemTypes';
import { AppError } from '@/server/lib/errors';
import { indexColumnFor } from '@/server/validation/fieldTypes';
import type { IndexColumn } from '@/types/fields';
import {
  BINARY_OPERATORS,
  LIST_OPERATORS,
  NULLARY_OPERATORS,
  isFilterGroup,
  isSystemFieldKey,
  type FilterClause,
  type FilterGroup,
  type FilterOperator,
  type SortSpec,
} from '@/types/filters';

export interface CompileContext {
  workspaceId: string;
  itemTypeId?: string;
  /** Live fields of the Item Type being filtered, keyed by `key`. */
  fieldsByKey: Map<string, Field>;
  /** Alias of the `items` row in the surrounding query. */
  alias?: string;
}

const VALUE_COLUMN: Record<IndexColumn, string> = {
  text: 'value_text',
  number: 'value_number',
  date: 'value_date',
  bool: 'value_bool',
  uuid: 'value_uuid',
  text_array: 'value_text_array',
};

/** Column reference on the projection row inside an EXISTS subquery. */
function indexColumn(column: IndexColumn): SQL {
  // `sql.identifier` quotes the name; the value itself comes from a closed map
  // keyed by an enum, never from caller input.
  return sql`ifi.${sql.identifier(VALUE_COLUMN[column])}`;
}

/** Escapes LIKE metacharacters so a user's `%` matches a literal percent. */
function likeEscape(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

function asString(value: unknown, operator: string): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new AppError('VALIDATION_ERROR', `"${operator}" needs a text value.`);
}

function asNumber(value: unknown, operator: string): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new AppError('VALIDATION_ERROR', `"${operator}" needs a numeric value.`);
  }
  return n;
}

function asDate(value: unknown, operator: string): Date {
  const dt = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(dt.getTime())) {
    throw new AppError('VALIDATION_ERROR', `"${operator}" needs a date value.`);
  }
  return dt;
}

function asList(value: unknown, operator: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new AppError('VALIDATION_ERROR', `"${operator}" needs a list of values.`);
  }
  if (value.length === 0) {
    throw new AppError('VALIDATION_ERROR', `"${operator}" needs at least one value.`);
  }
  if (value.length > 1000) {
    throw new AppError('VALIDATION_ERROR', `"${operator}" accepts at most 1000 values.`);
  }
  return value;
}

function asPair(value: unknown, operator: string): [unknown, unknown] {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new AppError('VALIDATION_ERROR', `"${operator}" needs exactly two values.`);
  }
  return [value[0], value[1]];
}

/** `(a, b, c)` as a bound list — never a joined string. */
function boundList(values: readonly unknown[]): SQL {
  return sql`(${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )})`;
}

function assertOperatorForColumn(
  operator: FilterOperator,
  column: IndexColumn,
  fieldLabel: string,
): void {
  const allowed: Record<IndexColumn, readonly FilterOperator[]> = {
    text: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'in', 'not_in', 'is_empty', 'is_not_empty'],
    number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'],
    date: ['eq', 'neq', 'before', 'after', 'on_or_before', 'on_or_after', 'between', 'in_last_days', 'in_next_days', 'is_empty', 'is_not_empty'],
    bool: ['is_true', 'is_false', 'is_empty', 'is_not_empty'],
    uuid: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
    text_array: ['has_any', 'has_all', 'has_none', 'is_empty', 'is_not_empty'],
  };

  if (!allowed[column].includes(operator)) {
    throw new AppError(
      'VALIDATION_ERROR',
      `"${operator.replace(/_/g, ' ')}" cannot be used on ${fieldLabel}.`,
      { operator, fieldLabel },
    );
  }
}

/** The predicate on the projection row, before it is wrapped in EXISTS. */
function valuePredicate(
  operator: FilterOperator,
  column: IndexColumn,
  value: unknown,
): SQL | null {
  const col = indexColumn(column);

  switch (operator) {
    case 'is_not_empty':
      return sql`${col} is not null`;
    case 'is_empty':
      // Handled by the caller as NOT EXISTS; there is no row to match.
      return null;

    case 'eq':
      return column === 'number'
        ? sql`${col} = ${asNumber(value, operator)}`
        : column === 'date'
          ? sql`${col} = ${asDate(value, operator)}`
          : sql`${col} = ${asString(value, operator)}`;

    case 'neq':
      return column === 'number'
        ? sql`${col} <> ${asNumber(value, operator)}`
        : column === 'date'
          ? sql`${col} <> ${asDate(value, operator)}`
          : sql`${col} <> ${asString(value, operator)}`;

    case 'contains':
      return sql`${col} ilike ${`%${likeEscape(asString(value, operator))}%`} escape '\\'`;
    case 'not_contains':
      return sql`${col} not ilike ${`%${likeEscape(asString(value, operator))}%`} escape '\\'`;
    case 'starts_with':
      return sql`${col} ilike ${`${likeEscape(asString(value, operator))}%`} escape '\\'`;
    case 'ends_with':
      return sql`${col} ilike ${`%${likeEscape(asString(value, operator))}`} escape '\\'`;

    case 'in':
      return sql`${col} in ${boundList(asList(value, operator))}`;
    case 'not_in':
      return sql`${col} not in ${boundList(asList(value, operator))}`;

    case 'gt':
      return sql`${col} > ${asNumber(value, operator)}`;
    case 'gte':
      return sql`${col} >= ${asNumber(value, operator)}`;
    case 'lt':
      return sql`${col} < ${asNumber(value, operator)}`;
    case 'lte':
      return sql`${col} <= ${asNumber(value, operator)}`;

    case 'before':
      return sql`${col} < ${asDate(value, operator)}`;
    case 'after':
      return sql`${col} > ${asDate(value, operator)}`;
    case 'on_or_before':
      return sql`${col} <= ${asDate(value, operator)}`;
    case 'on_or_after':
      return sql`${col} >= ${asDate(value, operator)}`;

    case 'between': {
      const [low, high] = asPair(value, operator);
      return column === 'date'
        ? sql`${col} between ${asDate(low, operator)} and ${asDate(high, operator)}`
        : sql`${col} between ${asNumber(low, operator)} and ${asNumber(high, operator)}`;
    }

    case 'in_last_days':
      return sql`${col} >= now() - make_interval(days => ${asNumber(value, operator)}) and ${col} <= now()`;
    case 'in_next_days':
      return sql`${col} >= now() and ${col} <= now() + make_interval(days => ${asNumber(value, operator)})`;

    case 'is_true':
      return sql`${col} = true`;
    case 'is_false':
      return sql`${col} = false`;

    case 'has_any':
      return sql`${col} && ${asList(value, operator) as string[]}::text[]`;
    case 'has_all':
      return sql`${col} @> ${asList(value, operator) as string[]}::text[]`;
    case 'has_none':
      return sql`not (${col} && ${asList(value, operator) as string[]}::text[])`;

    default:
      throw new AppError('VALIDATION_ERROR', `Unknown filter operator "${String(operator)}".`);
  }
}

function compileUserFieldClause(clause: FilterClause, ctx: CompileContext): SQL {
  const field = ctx.fieldsByKey.get(clause.field);
  if (!field) {
    // Never fall through to a raw column name. An unresolved key is the only
    // way caller input could reach SQL uncontrolled, so it is a hard error.
    throw new AppError('VALIDATION_ERROR', `There is no field named "${clause.field}".`, {
      field: clause.field,
    });
  }

  const column = indexColumnFor(field.type, field.config);
  assertOperatorForColumn(clause.operator, column, field.label);
  validateArity(clause);

  const itemRef = sql.identifier(ctx.alias ?? 'items');

  if (clause.operator === 'is_empty') {
    return sql`not exists (
      select 1 from item_field_index ifi
      where ifi.item_id = ${itemRef}.id
        and ifi.field_id = ${field.id}
        and ${indexColumn(column)} is not null
    )`;
  }

  const predicate = valuePredicate(clause.operator, column, clause.value);
  if (predicate === null) {
    throw new AppError('VALIDATION_ERROR', `Unsupported filter on "${field.label}".`);
  }

  // `not_contains`, `not_in`, and `has_none` must also match items with no
  // value at all — "status is not Done" plainly includes items with no status,
  // and an EXISTS alone would silently drop them.
  const negated =
    clause.operator === 'not_contains' ||
    clause.operator === 'not_in' ||
    clause.operator === 'has_none' ||
    clause.operator === 'neq';

  const exists = sql`exists (
    select 1 from item_field_index ifi
    where ifi.item_id = ${itemRef}.id
      and ifi.field_id = ${field.id}
      and ${predicate}
  )`;

  if (!negated) return exists;

  return sql`(${exists} or not exists (
    select 1 from item_field_index ifi
    where ifi.item_id = ${itemRef}.id
      and ifi.field_id = ${field.id}
      and ${indexColumn(column)} is not null
  ))`;
}

function validateArity(clause: FilterClause): void {
  const { operator, value } = clause;
  if (NULLARY_OPERATORS.has(operator)) return;
  if (value === undefined || value === null) {
    throw new AppError('VALIDATION_ERROR', `"${operator.replace(/_/g, ' ')}" needs a value.`);
  }
  if (BINARY_OPERATORS.has(operator)) asPair(value, operator);
  if (LIST_OPERATORS.has(operator)) asList(value, operator);
}

/**
 * System columns live on `items` itself, so they compile to a direct predicate
 * with no subquery. The column set is closed and mapped here — nothing derives
 * a column name from the clause.
 */
function compileSystemClause(clause: FilterClause, ctx: CompileContext): SQL {
  const itemRef = sql.identifier(ctx.alias ?? 'items');
  const op = clause.operator;

  switch (clause.field) {
    case '$title':
      return compileTextColumn(sql`${itemRef}.title`, op, clause.value);

    case '$created_at':
      return compileDateColumn(sql`${itemRef}.created_at`, op, clause.value);
    case '$updated_at':
      return compileDateColumn(sql`${itemRef}.updated_at`, op, clause.value);

    case '$completeness_pct':
      return compileNumberColumn(sql`${itemRef}.completeness_pct`, op, clause.value);

    case '$item_type_id':
      return compileUuidColumn(sql`${itemRef}.item_type_id`, op, clause.value);
    case '$parent_id':
      return compileUuidColumn(sql`${itemRef}.parent_id`, op, clause.value);
    case '$assignee_id':
      return compileUuidColumn(sql`${itemRef}.assignee_id`, op, clause.value);

    case '$is_variant':
      return op === 'is_true'
        ? sql`${itemRef}.variant_of_id is not null`
        : sql`${itemRef}.variant_of_id is null`;

    case '$has_invalid_values':
      return op === 'is_true'
        ? sql`${itemRef}.invalid_values <> '{}'::jsonb`
        : sql`${itemRef}.invalid_values = '{}'::jsonb`;

    case '$path': {
      // Subtree containment via the GiST index rather than a LIKE on the text
      // form, which could not use it.
      const path = asString(clause.value, op);
      return sql`${itemRef}.path <@ ${path}::ltree`;
    }

    case '$tree_node_id': {
      const nodeIds = Array.isArray(clause.value)
        ? (asList(clause.value, op) as string[])
        : [asString(clause.value, op)];

      if (clause.includeDescendants) {
        return sql`exists (
          select 1 from item_tree_nodes itn
          join tree_nodes tn on tn.id = itn.tree_node_id
          join tree_nodes scope on scope.id in ${boundList(nodeIds)}
          where itn.item_id = ${itemRef}.id and tn.path <@ scope.path
        )`;
      }
      return sql`exists (
        select 1 from item_tree_nodes itn
        where itn.item_id = ${itemRef}.id and itn.tree_node_id in ${boundList(nodeIds)}
      )`;
    }

    default:
      throw new AppError('VALIDATION_ERROR', `Unknown system field "${clause.field}".`);
  }
}

function compileTextColumn(col: SQL, op: FilterOperator, value: unknown): SQL {
  switch (op) {
    case 'eq':
      return sql`${col} = ${asString(value, op)}`;
    case 'neq':
      return sql`${col} <> ${asString(value, op)}`;
    case 'contains':
      return sql`${col} ilike ${`%${likeEscape(asString(value, op))}%`} escape '\\'`;
    case 'not_contains':
      return sql`${col} not ilike ${`%${likeEscape(asString(value, op))}%`} escape '\\'`;
    case 'starts_with':
      return sql`${col} ilike ${`${likeEscape(asString(value, op))}%`} escape '\\'`;
    case 'ends_with':
      return sql`${col} ilike ${`%${likeEscape(asString(value, op))}`} escape '\\'`;
    case 'in':
      return sql`${col} in ${boundList(asList(value, op))}`;
    case 'not_in':
      return sql`${col} not in ${boundList(asList(value, op))}`;
    case 'is_empty':
      return sql`(${col} is null or ${col} = '')`;
    case 'is_not_empty':
      return sql`(${col} is not null and ${col} <> '')`;
    default:
      throw new AppError('VALIDATION_ERROR', `"${op}" cannot be used on a text column.`);
  }
}

function compileNumberColumn(col: SQL, op: FilterOperator, value: unknown): SQL {
  switch (op) {
    case 'eq':
      return sql`${col} = ${asNumber(value, op)}`;
    case 'neq':
      return sql`${col} <> ${asNumber(value, op)}`;
    case 'gt':
      return sql`${col} > ${asNumber(value, op)}`;
    case 'gte':
      return sql`${col} >= ${asNumber(value, op)}`;
    case 'lt':
      return sql`${col} < ${asNumber(value, op)}`;
    case 'lte':
      return sql`${col} <= ${asNumber(value, op)}`;
    case 'between': {
      const [low, high] = asPair(value, op);
      return sql`${col} between ${asNumber(low, op)} and ${asNumber(high, op)}`;
    }
    case 'is_empty':
      return sql`${col} is null`;
    case 'is_not_empty':
      return sql`${col} is not null`;
    default:
      throw new AppError('VALIDATION_ERROR', `"${op}" cannot be used on a number column.`);
  }
}

function compileDateColumn(col: SQL, op: FilterOperator, value: unknown): SQL {
  switch (op) {
    case 'eq':
      return sql`${col}::date = ${asDate(value, op)}::date`;
    case 'neq':
      return sql`${col}::date <> ${asDate(value, op)}::date`;
    case 'before':
      return sql`${col} < ${asDate(value, op)}`;
    case 'after':
      return sql`${col} > ${asDate(value, op)}`;
    case 'on_or_before':
      return sql`${col} <= ${asDate(value, op)}`;
    case 'on_or_after':
      return sql`${col} >= ${asDate(value, op)}`;
    case 'between': {
      const [low, high] = asPair(value, op);
      return sql`${col} between ${asDate(low, op)} and ${asDate(high, op)}`;
    }
    case 'in_last_days':
      return sql`${col} >= now() - make_interval(days => ${asNumber(value, op)}) and ${col} <= now()`;
    case 'in_next_days':
      return sql`${col} >= now() and ${col} <= now() + make_interval(days => ${asNumber(value, op)})`;
    case 'is_empty':
      return sql`${col} is null`;
    case 'is_not_empty':
      return sql`${col} is not null`;
    default:
      throw new AppError('VALIDATION_ERROR', `"${op}" cannot be used on a date column.`);
  }
}

function compileUuidColumn(col: SQL, op: FilterOperator, value: unknown): SQL {
  switch (op) {
    case 'eq':
      return sql`${col} = ${asString(value, op)}::uuid`;
    case 'neq':
      return sql`(${col} is distinct from ${asString(value, op)}::uuid)`;
    case 'in':
      return sql`${col} in ${boundList(asList(value, op).map((v) => String(v)))}`;
    case 'not_in':
      return sql`(${col} is null or ${col} not in ${boundList(asList(value, op).map((v) => String(v)))})`;
    case 'is_empty':
      return sql`${col} is null`;
    case 'is_not_empty':
      return sql`${col} is not null`;
    default:
      throw new AppError('VALIDATION_ERROR', `"${op}" cannot be used on this column.`);
  }
}

const MAX_FILTER_DEPTH = 8;
const MAX_CLAUSES = 100;

/** Compiles a filter tree. Returns `null` for an empty filter (match all). */
export function compileFilter(
  filter: FilterGroup | undefined,
  ctx: CompileContext,
): SQL | null {
  if (!filter) return null;
  let clauseCount = 0;

  function walk(group: FilterGroup, depth: number): SQL | null {
    if (depth > MAX_FILTER_DEPTH) {
      throw new AppError('VALIDATION_ERROR', 'This filter is nested too deeply.');
    }

    const parts: SQL[] = [];
    for (const node of group.children) {
      if (isFilterGroup(node)) {
        const nested = walk(node, depth + 1);
        if (nested) parts.push(sql`(${nested})`);
        continue;
      }

      clauseCount += 1;
      if (clauseCount > MAX_CLAUSES) {
        throw new AppError('VALIDATION_ERROR', `A filter may have at most ${MAX_CLAUSES} rules.`);
      }

      parts.push(
        isSystemFieldKey(node.field)
          ? compileSystemClause(node, ctx)
          : compileUserFieldClause(node, ctx),
      );
    }

    if (parts.length === 0) return null;
    const joiner = group.op === 'or' ? sql` or ` : sql` and `;
    return sql.join(parts, joiner);
  }

  return walk(filter, 0);
}

/** One ORDER BY term, kept structured so keyset pagination can reuse it. */
export interface SortTerm {
  field: string;
  expr: SQL;
  direction: 'asc' | 'desc';
  nullsFirst: boolean;
  valueType: IndexColumn;
}

/**
 * Builds the ORDER BY terms.
 *
 * User fields sort through a correlated scalar subquery rather than a join, so
 * a multi-field sort does not multiply rows. The terms are returned structured
 * rather than pre-rendered because keyset pagination needs the same
 * expressions to build its cursor predicate — rendering them twice from two
 * code paths is how a sort and its cursor drift out of agreement and pages
 * start repeating rows.
 */
export function buildSortTerms(
  sorts: readonly SortSpec[] | undefined,
  ctx: CompileContext,
): SortTerm[] {
  const itemRef = sql.identifier(ctx.alias ?? 'items');
  const terms: SortTerm[] = [];

  for (const spec of sorts ?? []) {
    const direction = spec.direction === 'desc' ? 'desc' : 'asc';
    const nullsFirst = spec.nulls === 'first';

    if (isSystemFieldKey(spec.field)) {
      terms.push({
        field: spec.field,
        expr: systemSortColumn(spec.field, ctx),
        direction,
        nullsFirst,
        valueType: systemSortType(spec.field),
      });
      continue;
    }

    const field = ctx.fieldsByKey.get(spec.field);
    if (!field) {
      throw new AppError('VALIDATION_ERROR', `Cannot sort by "${spec.field}" — no such field.`);
    }
    const column = indexColumnFor(field.type, field.config);
    if (column === 'text_array') {
      throw new AppError(
        'VALIDATION_ERROR',
        `"${field.label}" holds several values per item, so it can be grouped but not sorted.`,
      );
    }
    terms.push({
      field: spec.field,
      expr: sql`(
        select ${indexColumn(column)} from item_field_index ifi
        where ifi.item_id = ${itemRef}.id and ifi.field_id = ${field.id}
      )`,
      direction,
      nullsFirst,
      valueType: column,
    });
  }

  return terms;
}

export function renderSortTerms(terms: readonly SortTerm[], ctx: CompileContext): SQL {
  const itemRef = sql.identifier(ctx.alias ?? 'items');
  const parts = terms.map(
    (t) =>
      sql`${t.expr} ${t.direction === 'desc' ? sql`desc` : sql`asc`} ${
        t.nullsFirst ? sql`nulls first` : sql`nulls last`
      }`,
  );
  // Always a total order: keyset pagination needs one, and two items sharing a
  // status and a title otherwise page unstably.
  parts.push(sql`${itemRef}.id asc`);
  return sql.join(parts, sql`, `);
}

export function compileSort(sorts: readonly SortSpec[] | undefined, ctx: CompileContext): SQL {
  return renderSortTerms(buildSortTerms(sorts, ctx), ctx);
}

function systemSortType(field: string): IndexColumn {
  switch (field) {
    case '$completeness_pct':
      return 'number';
    case '$created_at':
    case '$updated_at':
      return 'date';
    default:
      return 'text';
  }
}

function systemSortColumn(field: string, ctx: CompileContext): SQL {
  const itemRef = sql.identifier(ctx.alias ?? 'items');
  switch (field) {
    case '$title':
      return sql`${itemRef}.title`;
    case '$created_at':
      return sql`${itemRef}.created_at`;
    case '$updated_at':
      return sql`${itemRef}.updated_at`;
    case '$completeness_pct':
      return sql`${itemRef}.completeness_pct`;
    case '$path':
      return sql`${itemRef}.path`;
    default:
      throw new AppError('VALIDATION_ERROR', `Cannot sort by "${field}".`);
  }
}

/** Field keys a filter or sort references, so callers can auto-index them. */
export function referencedFieldKeys(
  filter: FilterGroup | undefined,
  sorts: readonly SortSpec[] | undefined,
): string[] {
  const keys = new Set<string>();

  function walk(group: FilterGroup): void {
    for (const node of group.children) {
      if (isFilterGroup(node)) walk(node);
      else if (!isSystemFieldKey(node.field)) keys.add(node.field);
    }
  }

  if (filter) walk(filter);
  for (const spec of sorts ?? []) {
    if (!isSystemFieldKey(spec.field)) keys.add(spec.field);
  }
  return [...keys];
}
