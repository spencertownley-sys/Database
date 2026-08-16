import { and, eq, isNull } from 'drizzle-orm';
import { withWorkspace } from '@/server/db';
import { fields as fieldsTable } from '@/server/db/schema/itemTypes';
import { handle, parseQuery } from '@/server/lib/route';
import { collection } from '@/lib/wire';
import { z } from 'zod';
import { assertCan } from '@/server/services/permissions.service';
import { getView } from '@/server/services/views.service';
import { searchProvider } from '@/server/search/PostgresSearchProvider';

export const dynamic = 'force-dynamic';

/** `GET /views/:id/items` — the §7 convenience wrapper: the view, applied. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handle(request, async ({ context }) => {
    const guestScopes =
      context.actor.role === 'guest'
        ? (context.actor.guestScopes ?? []).map((s) => ({
            treeNodePath: s.treeNodePath,
            includeDescendants: s.includeDescendants,
          }))
        : undefined;
    if (!guestScopes) {
      assertCan(context.actor, 'item.read', { kind: 'item', treeNodePaths: [] });
    }
    const query = parseQuery(
      request,
      z.object({ cursor: z.string().optional(), limit: z.coerce.number().min(1).max(500).default(100) }),
    );

    return withWorkspace(context.workspace.id, async (tx) => {
      const view = await getView(tx, context.workspace.id, id, context.actor.userId);
      const liveFields = await tx
        .select()
        .from(fieldsTable)
        .where(
          and(
            eq(fieldsTable.workspaceId, context.workspace.id),
            eq(fieldsTable.itemTypeId, view.itemTypeId),
            isNull(fieldsTable.deletedAt),
          ),
        );

      const page = await searchProvider.search(
        tx,
        context.workspace.id,
        liveFields,
        {
          itemTypeId: view.itemTypeId,
          filter: view.config.filter,
          sort: view.config.sort,
          search: view.config.search,
          incompleteOnly: view.config.incompleteOnly,
          treeNodeId: view.config.treeNodeId,
          treeIncludeDescendants: view.config.treeIncludeDescendants ?? true,
          includeVariants: true,
          guestScopes,
          limit: query.limit,
          cursor: query.cursor,
        },
        { withTotal: true },
      );

      return collection(page.items, {
        cursor: page.nextCursor ?? null,
        hasMore: Boolean(page.nextCursor),
        total: page.total ?? null,
      });
    });
  });
}
