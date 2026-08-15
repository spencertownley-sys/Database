import { withWorkspace } from '@/server/db';
import { handle, idempotencyKeyOf, parseBody } from '@/server/lib/route';
import {
  BULK_SYNC_THRESHOLD,
  commitChangeSet,
  previewChangeSet,
} from '@/server/services/changeSets.service';
import { assertCan } from '@/server/services/permissions.service';
import { shapeChangeSet } from '@/server/lib/changeSetWire';
import { changeSetInputSchema } from '@/server/validation/schemas';
import type { ChangeTarget } from '@/server/db/schema/changeSets';

export const dynamic = 'force-dynamic';

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
