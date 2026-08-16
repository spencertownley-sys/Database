import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { handle, idempotencyKeyOf, parseBody } from '@/server/lib/route';
import { shapeChangeSet } from '@/server/lib/changeSetWire';
import { assertCan } from '@/server/services/permissions.service';
import {
  commitChangeSet,
  previewChangeSet,
} from '@/server/services/changeSets.service';
import { uuidSchema } from '@/server/validation/schemas';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  itemIds: z.array(uuidSchema).min(1).max(10_000),
  /** Skip the preview for small assignments; §6 defaults to previewing. */
  autoCommit: z.boolean().optional(),
});

/** `POST /tree-nodes/:id/items` — bulk assign, through a change set (§6). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return membershipChange(request, params, 'tree_assign');
}

/** `DELETE /tree-nodes/:id/items` — bulk unassign, through a change set (§6). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return membershipChange(request, params, 'tree_unassign');
}

async function membershipChange(
  request: Request,
  params: Promise<{ id: string }>,
  operation: 'tree_assign' | 'tree_unassign',
): Promise<Response> {
  const { id } = await params;
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'tree_node.assign_items', {
        kind: 'item',
        treeNodePaths: [],
      });
      const input = await parseBody(request, bodySchema);

      return withWorkspace(context.workspace.id, async (tx) => {
        const changeContext = {
          workspaceId: context.workspace.id,
          actor: context.actor,
          source: context.actor.apiKey ? ('api' as const) : ('user' as const),
          idempotencyKey: idempotencyKeyOf(request),
        };

        const { changeSet, requiresAsyncCommit } = await previewChangeSet(tx, changeContext, {
          operation,
          target: { kind: 'ids', itemIds: input.itemIds },
          patch: { treeNodeIds: [id] },
        });

        if (!input.autoCommit || requiresAsyncCommit) {
          return { ...shapeChangeSet(changeSet), requiresAsyncCommit };
        }

        const result = await commitChangeSet(tx, changeContext, changeSet.id);
        return {
          ...shapeChangeSet(result.changeSet),
          committed: true,
          appliedCount: result.appliedCount,
          skippedCount: result.skippedCount,
        };
      });
    },
    { limit: 'write', status: 201 },
  );
}
