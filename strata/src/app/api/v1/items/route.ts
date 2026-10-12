import { and, eq, isNull } from 'drizzle-orm';
import { withWorkspace } from '@/server/db';
import { fields as fieldsTable } from '@/server/db/schema/itemTypes';
import { handle, parseQuery } from '@/server/lib/route';
import { assertCan } from '@/server/services/permissions.service';
import { searchProvider } from '@/server/search/PostgresSearchProvider';
import { referencedFieldKeys } from '@/server/search/filterCompiler';
import { ensureFieldsIndexed } from '@/server/services/fields.service';
import { listItemsQuerySchema } from '@/server/validation/schemas';
import type { FilterGroup, SortSpec } from '@/types/filters';

export const dynamic = 'force-dynamic';

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
            query.itemType ? eq(fieldsTable.itemTypeId, query.itemType) : undefined,
            isNull(fieldsTable.deletedAt),
          ),
        );

      // Filtering or sorting on a field is the signal that it is worth
      // indexing. Flipping `is_indexed` here (and backfilling in the
      // background) is what keeps write cost proportional to the fields people
      // actually query rather than to every field they ever defined.
      await ensureFieldsIndexed(
        tx,
        context.workspace.id,
        referencedFieldKeys(query.filter as FilterGroup | undefined, query.sort as SortSpec[]),
        liveFields,
      );

      const page = await searchProvider.search(
        tx,
        context.workspace.id,
        liveFields,
        {
          itemTypeId: query.itemType,
          filter: query.filter as FilterGroup | undefined,
          sort: query.sort as SortSpec[] | undefined,
          search: query.search,
          underItemId: query.under,
          treeNodeId: query.treeNode,
          treeIncludeDescendants: query.treeIncludeDescendants,
          incompleteOnly: query.incompleteOnly,
          includeVariants: query.includeVariants,
          limit: query.limit,
          cursor: query.cursor,
        },
        { withTotal: query.withTotal },
      );

      return {
        items: page.items,
        nextCursor: page.nextCursor ?? null,
        total: page.total ?? null,
      };
    });
  });
}
