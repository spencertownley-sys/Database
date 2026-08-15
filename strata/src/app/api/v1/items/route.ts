import { and, eq, isNull, inArray } from 'drizzle-orm';
import { withWorkspace } from '@/server/db';
import { fields as fieldsTable, itemTypes } from '@/server/db/schema/itemTypes';
import type { Item } from '@/server/db/schema/items';
import { handle, parseQuery } from '@/server/lib/route';
import { collection } from '@/lib/wire';
import { assertCan } from '@/server/services/permissions.service';
import { searchProvider } from '@/server/search/PostgresSearchProvider';
import { listItemsQuerySchema } from '@/server/validation/schemas';
import type { FilterGroup, SortSpec } from '@/types/filters';

export const dynamic = 'force-dynamic';

/**
 * `GET /items` — the most-used endpoint in the product; backs every grid,
 * list, and board load. Response is the §1.2 collection envelope:
 * `{ data, meta: { cursor, has_more, total } }`, `total` null past 10k.
 */
export async function GET(request: Request): Promise<Response> {
  return handle(request, async ({ context }) => {
    assertCan(context.actor, 'item.read', { kind: 'item', treeNodePaths: [] });
    const query = parseQuery(request, listItemsQuerySchema);

    return withWorkspace(context.workspace.id, async (tx) => {
      const liveFields = await tx
        .select()
        .from(fieldsTable)
        .where(
          and(
            eq(fieldsTable.workspaceId, context.workspace.id),
            query.itemTypeId ? eq(fieldsTable.itemTypeId, query.itemTypeId) : undefined,
            isNull(fieldsTable.deletedAt),
          ),
        );

      // Deliberately NO auto-indexing here: a clause on a non-indexed field
      // returns 400 FIELD_NOT_FILTERABLE (compiled below), whose
      // `details.action` names the PATCH that indexes the field via an
      // explicit, opt-in backfill. Turning a user's first filter into a
      // synchronous full-table backfill is the exact latency spike the error
      // exists to prevent (API Design §4.1, SPEC_RECONCILIATION §1.3).
      const page = await searchProvider.search(
        tx,
        context.workspace.id,
        liveFields,
        {
          itemTypeId: query.itemTypeId,
          filter: query.filter as FilterGroup | undefined,
          sort: query.sort as SortSpec[] | undefined,
          search: query.q,
          underItemId: query.inSubtree,
          parentId: query.parentId,
          variantParentId: query.variantParentId,
          treeNodeId: query.treeNodeId,
          treeIncludeDescendants: query.includeDescendants ?? true,
          incompleteOnly: query.incompleteOnly,
          // §4: variants are in the result set unless explicitly excluded.
          includeVariants: query.includeVariants ?? true,
          limit: query.limit,
          cursor: query.cursor,
        },
        { withTotal: true },
      );

      const wanted = parseFieldSelection(query.fields);
      const expansions = parseExpand(query.expand);

      let data: Array<Record<string, unknown>> = wanted
        ? page.items.map((item) => restrictFields(item, wanted))
        : (page.items as unknown as Array<Record<string, unknown>>);

      if (expansions.has('item_type')) {
        const typeIds = [...new Set(page.items.map((i) => i.itemTypeId))];
        const types = typeIds.length
          ? await tx
              .select()
              .from(itemTypes)
              .where(
                and(
                  eq(itemTypes.workspaceId, context.workspace.id),
                  inArray(itemTypes.id, typeIds),
                ),
              )
          : [];
        const byId = new Map(types.map((t) => [t.id, t]));
        data = data.map((row) => ({
          ...row,
          itemType: byId.get(row.itemTypeId as string) ?? null,
        }));
      }

      return collection(data, {
        cursor: page.nextCursor ?? null,
        hasMore: page.nextCursor !== undefined,
        total: page.total ?? null,
      });
    });
  });
}

/** `?fields=title,status` — payload discipline for wide types (§1.2). */
function parseFieldSelection(raw: string | undefined): Set<string> | null {
  if (!raw) return null;
  const keys = raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);
  return keys.length > 0 ? new Set(keys) : null;
}

function parseExpand(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
  );
}

function restrictFields(item: Item, wanted: Set<string>): Record<string, unknown> {
  const pickBag = (bag: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const key of wanted) {
      if (Object.prototype.hasOwnProperty.call(bag, key)) out[key] = bag[key];
    }
    return out;
  };
  return {
    ...item,
    values: pickBag(item.values),
    effectiveValues: pickBag(item.effectiveValues),
    invalidValues: pickBag(item.invalidValues as Record<string, unknown>),
  };
}
