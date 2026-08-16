import { and, desc, eq, exists, inArray, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { changeEntries, changeSets } from '@/server/db/schema/changeSets';
import { users } from '@/server/db/schema/workspaces';
import { handle, idempotencyKeyOf, parseBody, parseQuery } from '@/server/lib/route';
import { collection } from '@/lib/wire';
import {
  BULK_SYNC_THRESHOLD,
  commitChangeSet,
  previewChangeSet,
} from '@/server/services/changeSets.service';
import { assertCan } from '@/server/services/permissions.service';
import { shapeChangeSet } from '@/server/lib/changeSetWire';
import { emitCommitted } from '@/server/lib/webhookEmit';
import { changeSetInputSchema } from '@/server/validation/schemas';
import type { ChangeTarget } from '@/server/db/schema/changeSets';

export const dynamic = 'force-dynamic';

const listQuerySchema = z.object({
  itemId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  operation: z.string().max(40).optional(),
  status: z.string().max(40).optional(),
  cursor: z.string().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * `GET /change-sets` — backs both the workspace activity feed and the
 * per-item history (§5). `item_id` filters through `change_entries`, which is
 * exactly what the per-item feed is: every set that touched the item.
 */
export async function GET(request: Request): Promise<Response> {
  return handle(request, async ({ context }) => {
    const query = parseQuery(request, listQuerySchema);

    return withWorkspace(context.workspace.id, async (tx) => {
      const rows = await tx
        .select({
          id: changeSets.id,
          operation: changeSets.operation,
          status: changeSets.status,
          source: changeSets.source,
          itemTypeId: changeSets.itemTypeId,
          actorId: changeSets.actorId,
          actorName: users.name,
          itemCount: changeSets.itemCount,
          skippedCount: changeSets.skippedCount,
          summary: changeSets.summary,
          committedAt: changeSets.committedAt,
          undoneByChangeSetId: changeSets.undoneByChangeSetId,
          createdAt: changeSets.createdAt,
        })
        .from(changeSets)
        .leftJoin(users, eq(users.id, changeSets.actorId))
        .where(
          and(
            eq(changeSets.workspaceId, context.workspace.id),
            inArray(changeSets.status, ['committed', 'undone']),
            query.actorId ? eq(changeSets.actorId, query.actorId) : undefined,
            query.operation
              ? sql`${changeSets.operation} = ${query.operation}`
              : undefined,
            query.status ? sql`${changeSets.status} = ${query.status}` : undefined,
            query.itemId
              ? exists(
                  tx
                    .select({ one: sql`1` })
                    .from(changeEntries)
                    .where(
                      and(
                        eq(changeEntries.changeSetId, changeSets.id),
                        eq(changeEntries.itemId, query.itemId),
                      ),
                    ),
                )
              : undefined,
            query.cursor ? lt(changeSets.createdAt, new Date(query.cursor)) : undefined,
          ),
        )
        .orderBy(desc(changeSets.createdAt))
        .limit(query.limit + 1);

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page[page.length - 1];

      return collection(page, {
        cursor: hasMore && last ? last.createdAt.toISOString() : null,
        hasMore,
        total: null,
      });
    });
  });
}

/**
 * Creates a preview.
 *
 * `autoCommit` is the single-item path — the grid uses it for a cell edit, so
 * the write still produces a change set (and therefore an undo and an activity
 * record) without putting a modal in front of a one-cell change. It is refused
 * above the bulk threshold: a change large enough to need a job is large
 * enough to deserve being looked at first.
 */
export async function POST(request: Request): Promise<Response> {
  return handle(
    request,
    async ({ context }) => {
      const input = await parseBody(request, changeSetInputSchema);

      assertCan(context.actor, 'change_set.preview', { kind: 'change_set' });
      if (input.autoCommit) {
        assertCan(context.actor, 'change_set.commit', { kind: 'change_set' });
      }

      return withWorkspace(context.workspace.id, async (tx) => {
        const changeContext = {
          workspaceId: context.workspace.id,
          actor: context.actor,
          source: context.actor.apiKey ? ('api' as const) : ('user' as const),
          idempotencyKey: idempotencyKeyOf(request),
        };

        const { changeSet, requiresAsyncCommit } = await previewChangeSet(tx, changeContext, {
          operation: input.operation,
          itemTypeId: input.itemTypeId,
          target: input.target as ChangeTarget,
          patch: input.patch,
        });

        if (!input.autoCommit) {
          return { ...shapeChangeSet(changeSet), requiresAsyncCommit };
        }

        if (requiresAsyncCommit) {
          return {
            ...shapeChangeSet(changeSet),
            requiresAsyncCommit,
            committed: false,
            message: `This affects ${changeSet.itemCount.toLocaleString()} items — more than the ${BULK_SYNC_THRESHOLD} that apply immediately. Review the preview and commit it.`,
          };
        }

        const result = await commitChangeSet(tx, changeContext, changeSet.id);
        emitCommitted(context.workspace.id, result.changeSet, {
          appliedCount: result.appliedCount,
          itemId: input.target.itemIds?.[0] ?? null,
        });
        return {
          ...shapeChangeSet(result.changeSet),
          requiresAsyncCommit: false,
          committed: true,
          appliedCount: result.appliedCount,
          skippedCount: result.skippedCount,
          variantsPropagated: result.variantsPropagated,
        };
      });
    },
    { limit: 'write', status: 201 },
  );
}
