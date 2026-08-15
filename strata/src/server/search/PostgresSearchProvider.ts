/**
 * The v1 search implementation.
 *
 * Two decisions shape everything here.
 *
 * **Keyset pagination, never OFFSET.** At 100k items an `OFFSET 40000` scan
 * re-reads forty thousand rows to discard them, so deep pages fall off the
 * performance budget and — worse — a row inserted while someone pages causes a
 * silent duplicate or skip. The cursor encodes the sort tuple plus the id
 * tiebreaker, and the next page is a range predicate the index can serve.
 *
 * **The cursor predicate is derived from the same `SortTerm[]` as ORDER BY.**
 * Building them separately is how a sort and its pagination drift apart and
 * pages start repeating rows; both come from `buildSortTerms`.
 */

import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@/server/db';
import type { Field } from '@/server/db/schema/itemTypes';
import type { Item } from '@/server/db/schema/items';
import { AppError } from '@/server/lib/errors';
import { indexColumnFor } from '@/server/validation/fieldTypes';
import type { FilterGroup, GroupSpec } from '@/types/filters';
import { isSystemFieldKey } from '@/types/filters';
import {
  buildSortTerms,
  compileFilter,
  renderSortTerms,
  type CompileContext,
  type SortTerm,
} from './filterCompiler';
import type {
  GroupBucket,
  SearchPage,
  SearchProvider,
  SearchQuery,
} from './SearchProvider';

const ITEM_ALIAS = 'i';

function contextFor(
  workspaceId: string,
  fields: readonly Field[],
  itemTypeId?: string,
): CompileContext {
  return {
    workspaceId,
    itemTypeId,
    fieldsByKey: new Map(fields.map((f) => [f.key, f])),
    alias: ITEM_ALIAS,
  };
}

function likeEscape(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

// ---------------------------------------------------------------------------
// cursors
// ---------------------------------------------------------------------------

interface CursorPayload {
  v: Array<string | number | boolean | null>;
  id: string;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): CursorPayload {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorPayload;
    if (!Array.isArray(parsed.v) || typeof parsed.id !== 'string') throw new Error('shape');
    return parsed;
  } catch {
    throw new AppError('VALIDATION_ERROR', 'That page cursor is not valid. Start from page one.');
  }
}

/** Binds a cursor value at the type its sort expression produces. */
function bindCursorValue(term: SortTerm, value: string | number | boolean | null): SQL {
  if (value === null) return sql`null`;
  switch (term.valueType) {
    case 'number':
      return sql`${Number(value)}::numeric`;
    case 'date':
      return sql`${String(value)}::timestamptz`;
    case 'bool':
      return sql`${Boolean(value)}::boolean`;
    case 'uuid':
      return sql`${String(value)}::uuid`;
    default:
      return sql`${String(value)}::text`;
  }
}

/**
 * The "strictly after the cursor" predicate, in lexicographic order.
 *
 * For sort terms s1…sn plus the id tiebreaker this expands to
 *
 *   after(s1) OR (eq(s1) AND after(s2)) OR … OR (eq(s1..sn) AND id > cursorId)
 *
 * NULL ordering is handled per term rather than globally: with `NULLS LAST`
 * every NULL sorts after every value, so "after a non-null cursor value" has to
 * include the NULLs, and "after a NULL cursor value" excludes everything but
 * the id tiebreaker. Getting this wrong loses whole pages of items whose sort
 * field is empty — which, in a product built around finding incomplete
 * records, is exactly the data users are looking for.
 */
function cursorPredicate(terms: readonly SortTerm[], cursor: CursorPayload): SQL {
  const itemRef = sql.identifier(ITEM_ALIAS);
  const branches: SQL[] = [];

  for (let i = 0; i < terms.length; i += 1) {
    const term = terms[i] as SortTerm;
    const raw = cursor.v[i] ?? null;
    const bound = bindCursorValue(term, raw);

    let after: SQL | null;
    if (raw === null) {
      after = term.nullsFirst ? sql`${term.expr} is not null` : null;
    } else if (term.direction === 'asc') {
      after = term.nullsFirst
        ? sql`${term.expr} > ${bound}`
        : sql`(${term.expr} > ${bound} or ${term.expr} is null)`;
    } else {
      after = term.nullsFirst
        ? sql`${term.expr} < ${bound}`
        : sql`(${term.expr} < ${bound} or ${term.expr} is null)`;
    }

    if (after !== null) {
      const equalities = terms.slice(0, i).map((t, j) => equalityFor(t, cursor.v[j] ?? null));
      branches.push(
        equalities.length === 0
          ? after
          : sql`(${sql.join([...equalities, after], sql` and `)})`,
      );
    }
  }

  const allEqual = terms.map((t, i) => equalityFor(t, cursor.v[i] ?? null));
  const tiebreak = sql`${itemRef}.id > ${cursor.id}::uuid`;
  branches.push(
    allEqual.length === 0 ? tiebreak : sql`(${sql.join([...allEqual, tiebreak], sql` and `)})`,
  );

  return sql`(${sql.join(branches, sql` or `)})`;
}

function equalityFor(term: SortTerm, value: string | number | boolean | null): SQL {
  // `IS NOT DISTINCT FROM` so a NULL cursor value matches a NULL row value;
  // plain `=` would evaluate to NULL and drop the branch.
  return sql`${term.expr} is not distinct from ${bindCursorValue(term, value)}`;
}

function cursorValuesFor(item: Item, terms: readonly SortTerm[]): CursorPayload['v'] {
  return terms.map((term) => {
    switch (term.field) {
      case '$title':
        return item.title;
      case '$created_at':
        return item.createdAt.toISOString();
      case '$updated_at':
        return item.updatedAt.toISOString();
      case '$completeness_pct':
        return item.completenessPct;
      case '$path':
        return item.path;
      default: {
        const value = item.effectiveValues[term.field];
        if (value === null || value === undefined) return null;
        if (Array.isArray(value)) return String(value[0] ?? '');
        if (typeof value === 'boolean' || typeof value === 'number') return value;
        return String(value);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// where clause
// ---------------------------------------------------------------------------

function buildWhere(
  workspaceId: string,
  fields: readonly Field[],
  query: Omit<SearchQuery, 'limit' | 'cursor'>,
): SQL {
  const itemRef = sql.identifier(ITEM_ALIAS);
  const parts: SQL[] = [
    sql`${itemRef}.workspace_id = ${workspaceId}::uuid`,
    sql`${itemRef}.deleted_at is null`,
  ];

  if (query.itemTypeId) {
    parts.push(sql`${itemRef}.item_type_id = ${query.itemTypeId}::uuid`);
  }

  if (!query.includeVariants) {
    // Variants are shown nested under their model, not as loose grid rows.
    parts.push(sql`${itemRef}.variant_of_id is null`);
  }

  if (query.incompleteOnly) {
    parts.push(sql`${itemRef}.completeness_pct < 100`);
  }

  if (query.underItemId) {
    parts.push(sql`${itemRef}.path <@ (
      select path from items where id = ${query.underItemId}::uuid
    )`);
  }

  if (query.parentId) {
    parts.push(sql`${itemRef}.parent_id = ${query.parentId}::uuid`);
  }

  if (query.variantParentId) {
    parts.push(sql`${itemRef}.variant_of_id = ${query.variantParentId}::uuid`);
  }

  if (query.treeNodeId) {
    parts.push(
      query.treeIncludeDescendants
        ? sql`exists (
            select 1 from item_tree_nodes itn
            join tree_nodes tn on tn.id = itn.tree_node_id
            where itn.item_id = ${itemRef}.id
              and tn.path <@ (select path from tree_nodes where id = ${query.treeNodeId}::uuid)
          )`
        : sql`exists (
            select 1 from item_tree_nodes itn
            where itn.item_id = ${itemRef}.id
              and itn.tree_node_id = ${query.treeNodeId}::uuid
          )`,
    );
  }

  if (query.search && query.search.trim()) {
    // ILIKE '%q%' is served by the gin_trgm_ops index on search_text, which is
    // why search_text exists as a denormalised column at all.
    const term = `%${likeEscape(query.search.trim())}%`;
    parts.push(sql`${itemRef}.search_text ilike ${term} escape '\\'`);
  }

  const compiled = compileFilter(
    query.filter as FilterGroup | undefined,
    contextFor(workspaceId, fields, query.itemTypeId),
  );
  if (compiled) parts.push(sql`(${compiled})`);

  return sql.join(parts, sql` and `);
}

const SELECT_COLUMNS = sql`
  ${sql.identifier(ITEM_ALIAS)}.id,
  ${sql.identifier(ITEM_ALIAS)}.workspace_id as "workspaceId",
  ${sql.identifier(ITEM_ALIAS)}.item_type_id as "itemTypeId",
  ${sql.identifier(ITEM_ALIAS)}.title,
  ${sql.identifier(ITEM_ALIAS)}.parent_id as "parentId",
  ${sql.identifier(ITEM_ALIAS)}.path::text as path,
  ${sql.identifier(ITEM_ALIAS)}.order_key as "orderKey",
  ${sql.identifier(ITEM_ALIAS)}.is_variant_model as "isVariantModel",
  ${sql.identifier(ITEM_ALIAS)}.variant_of_id as "variantOfId",
  ${sql.identifier(ITEM_ALIAS)}.variant_axis_values as "variantAxisValues",
  ${sql.identifier(ITEM_ALIAS)}.values,
  ${sql.identifier(ITEM_ALIAS)}.effective_values as "effectiveValues",
  ${sql.identifier(ITEM_ALIAS)}.invalid_values as "invalidValues",
  ${sql.identifier(ITEM_ALIAS)}.completeness_pct as "completenessPct",
  ${sql.identifier(ITEM_ALIAS)}.missing_required as "missingRequired",
  ${sql.identifier(ITEM_ALIAS)}.search_text as "searchText",
  ${sql.identifier(ITEM_ALIAS)}.assignee_id as "assigneeId",
  ${sql.identifier(ITEM_ALIAS)}.created_by as "createdBy",
  ${sql.identifier(ITEM_ALIAS)}.updated_by as "updatedBy",
  ${sql.identifier(ITEM_ALIAS)}.created_at as "createdAt",
  ${sql.identifier(ITEM_ALIAS)}.updated_at as "updatedAt",
  ${sql.identifier(ITEM_ALIAS)}.deleted_at as "deletedAt"
`;

// ---------------------------------------------------------------------------
// provider
// ---------------------------------------------------------------------------

/** Above this, `total` is reported as `null` (API Design §1.2). */
export const TOTAL_COUNT_CAP = 10_000;

export class PostgresSearchProvider implements SearchProvider {
  async search(
    tx: Tx,
    workspaceId: string,
    fields: readonly Field[],
    query: SearchQuery,
    opts: { withTotal?: boolean } = {},
  ): Promise<SearchPage> {
    const ctx = contextFor(workspaceId, fields, query.itemTypeId);
    const terms = buildSortTerms(query.sort, ctx);
    const where = buildWhere(workspaceId, fields, query);

    const limit = Math.min(Math.max(query.limit, 1), 500);
    const keyset = query.cursor ? cursorPredicate(terms, decodeCursor(query.cursor)) : null;

    // One extra row decides whether there is a next page, without a count.
    const rows = await tx.execute(sql`
      select ${SELECT_COLUMNS}
      from items ${sql.identifier(ITEM_ALIAS)}
      where ${where}${keyset ? sql` and ${keyset}` : sql``}
      order by ${renderSortTerms(terms, ctx)}
      limit ${limit + 1}
    `);

    // Raw `tx.execute` rows carry timestamps as Postgres strings; the wire
    // contract is RFC 3339, which `toWire` produces from Date instances.
    const list = ([...rows] as unknown as Item[]).map((item) => ({
      ...item,
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
      deletedAt: item.deletedAt ? new Date(item.deletedAt) : null,
    }));
    const hasMore = list.length > limit;
    const page = hasMore ? list.slice(0, limit) : list;

    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last ? encodeCursor({ v: cursorValuesFor(last, terms), id: last.id }) : undefined;

    const result: SearchPage = { items: page };
    if (nextCursor) result.nextCursor = nextCursor;
    if (opts.withTotal) result.total = await this.count(tx, workspaceId, fields, query);
    return result;
  }

  async count(
    tx: Tx,
    workspaceId: string,
    fields: readonly Field[],
    query: Omit<SearchQuery, 'limit' | 'cursor'>,
  ): Promise<number | null> {
    const where = buildWhere(workspaceId, fields, query);
    // Bounded: past 10,000 an exact count reads rows nobody will page through,
    // and the API contract (§1.2) returns `total: null` instead.
    const rows = await tx.execute(sql`
      select count(*)::int as n from (
        select 1 from items ${sql.identifier(ITEM_ALIAS)} where ${where} limit ${TOTAL_COUNT_CAP + 1}
      ) bounded
    `);
    const n = Number(([...rows][0] as { n: number } | undefined)?.n ?? 0);
    return n > TOTAL_COUNT_CAP ? null : n;
  }

  /**
   * Group buckets with their aggregates, in one grouped query rather than one
   * query per group. A board with 12 columns must not issue 12 round trips.
   */
  async groupCounts(
    tx: Tx,
    workspaceId: string,
    fields: readonly Field[],
    query: Omit<SearchQuery, 'limit' | 'cursor'>,
    group: GroupSpec,
    aggregateFieldKey?: string,
  ): Promise<GroupBucket[]> {
    const where = buildWhere(workspaceId, fields, query);
    const itemRef = sql.identifier(ITEM_ALIAS);

    let groupExpr: SQL;
    if (isSystemFieldKey(group.field)) {
      switch (group.field) {
        case '$assignee_id':
          groupExpr = sql`${itemRef}.assignee_id::text`;
          break;
        case '$item_type_id':
          groupExpr = sql`${itemRef}.item_type_id::text`;
          break;
        case '$parent_id':
          groupExpr = sql`${itemRef}.parent_id::text`;
          break;
        default:
          throw new AppError('VALIDATION_ERROR', `Cannot group by "${group.field}".`);
      }
    } else {
      const field = fields.find((f) => f.key === group.field);
      if (!field) {
        throw new AppError('VALIDATION_ERROR', `Cannot group by "${group.field}" — no such field.`);
      }
      const column = indexColumnFor(field.type, field.config);
      if (column === 'text_array') {
        // A multi-select item belongs to several buckets at once; the grid
        // treats that as unsupported rather than silently duplicating rows.
        throw new AppError(
          'VALIDATION_ERROR',
          `"${field.label}" allows several values per item, so it cannot group rows.`,
        );
      }
      groupExpr = sql`(
        select ifi.${sql.identifier(columnName(column))}::text from item_field_index ifi
        where ifi.item_id = ${itemRef}.id and ifi.field_id = ${field.id}
      )`;
    }

    let aggregateExpr: SQL = sql`null::numeric`;
    if (aggregateFieldKey) {
      const field = fields.find((f) => f.key === aggregateFieldKey);
      if (field && indexColumnFor(field.type, field.config) === 'number') {
        aggregateExpr = sql`(
          select ifi.value_number from item_field_index ifi
          where ifi.item_id = ${itemRef}.id and ifi.field_id = ${field.id}
        )`;
      }
    }

    const rows = await tx.execute(sql`
      select
        g.key,
        count(*)::int as count,
        sum(g.agg)::float8 as sum,
        avg(g.agg)::float8 as avg,
        avg(g.completeness)::float8 as avg_completeness
      from (
        select
          ${groupExpr} as key,
          ${aggregateExpr} as agg,
          ${itemRef}.completeness_pct as completeness
        from items ${itemRef}
        where ${where}
      ) g
      group by g.key
      order by g.key ${group.direction === 'desc' ? sql`desc` : sql`asc`} nulls last
    `);

    return ([...rows] as Array<{
      key: string | null;
      count: number;
      sum: number | null;
      avg: number | null;
      avg_completeness: number | null;
    }>).map((row) => ({
      key: row.key,
      count: Number(row.count),
      ...(row.sum !== null ? { sum: Number(row.sum) } : {}),
      ...(row.avg !== null ? { avg: Number(row.avg) } : {}),
      avgCompleteness: Math.round(Number(row.avg_completeness ?? 0)),
    }));
  }

  async resolveIds(
    tx: Tx,
    workspaceId: string,
    fields: readonly Field[],
    query: Omit<SearchQuery, 'limit' | 'cursor'>,
    max: number,
  ): Promise<string[]> {
    const where = buildWhere(workspaceId, fields, query);
    const rows = await tx.execute(sql`
      select ${sql.identifier(ITEM_ALIAS)}.id
      from items ${sql.identifier(ITEM_ALIAS)}
      where ${where}
      order by ${sql.identifier(ITEM_ALIAS)}.id
      limit ${max + 1}
    `);

    const ids = ([...rows] as Array<{ id: string }>).map((r) => r.id);
    if (ids.length > max) {
      throw new AppError(
        'TARGET_TOO_LARGE',
        `That filter matches more than ${max.toLocaleString()} items. Narrow it before applying a change.`,
        { limit: max },
      );
    }
    return ids;
  }
}

function columnName(column: string): string {
  switch (column) {
    case 'text':
      return 'value_text';
    case 'number':
      return 'value_number';
    case 'date':
      return 'value_date';
    case 'bool':
      return 'value_bool';
    case 'uuid':
      return 'value_uuid';
    default:
      return 'value_text_array';
  }
}

export const searchProvider: SearchProvider = new PostgresSearchProvider();

/**
 * Resolves a filter-targeted change set to concrete ids.
 *
 * Deliberately re-resolved at *preview* time and frozen into the change set's
 * entries afterwards: a filter that is re-evaluated at commit could pick up
 * items created in between, so the user would commit a change to rows they
 * never previewed.
 */
export async function resolveFilterToIds(
  tx: Tx,
  workspaceId: string,
  filter: unknown,
  max: number,
): Promise<string[]> {
  const { fields: fieldsTable } = await import('@/server/db/schema/itemTypes');
  const { eq, and, isNull } = await import('drizzle-orm');

  const liveFields = await tx
    .select()
    .from(fieldsTable)
    .where(and(eq(fieldsTable.workspaceId, workspaceId), isNull(fieldsTable.deletedAt)));

  return searchProvider.resolveIds(
    tx,
    workspaceId,
    liveFields,
    { filter: filter as FilterGroup | undefined },
    max,
  );
}
