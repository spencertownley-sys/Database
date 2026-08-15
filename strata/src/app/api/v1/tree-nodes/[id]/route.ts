import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { handle, parseBody } from '@/server/lib/route';
import { AppError } from '@/server/lib/errors';
import { assertCan } from '@/server/services/permissions.service';
import { deleteNode, updateNode, type NodeDisposition } from '@/server/services/trees.service';
import { uuidSchema } from '@/server/validation/schemas';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  label: z.string().min(1).max(200).optional(),
  /** Reparent — rewrites the whole subtree's paths in one statement. */
  parentId: uuidSchema.nullable().optional(),
  /** Place before this sibling; `null` places last. */
  beforeNodeId: uuidSchema.nullable().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'tree_node.update', { kind: 'tree' });
      const input = await parseBody(request, patchSchema);
      return withWorkspace(context.workspace.id, (tx) =>
        updateNode(tx, context.workspace.id, id, input),
      );
    },
    { limit: 'write' },
  );
}

/**
 * `DELETE /tree-nodes/:id?on_members=unassign|move_to_parent|move_to[&target_node_id=…]`
 * — §6: a node with members needs an explicit disposition; items are never
 * silently orphaned.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'tree_node.delete', { kind: 'tree' });

      const url = new URL(request.url);
      const onMembers = url.searchParams.get('on_members');
      const targetNodeId = url.searchParams.get('target_node_id');

      let disposition: NodeDisposition | null = null;
      if (onMembers === 'unassign') disposition = { onMembers: 'unassign' };
      else if (onMembers === 'move_to_parent') disposition = { onMembers: 'move_to_parent' };
      else if (onMembers === 'move_to') {
        if (!targetNodeId) {
          throw new AppError('VALIDATION_ERROR', 'move_to needs a target_node_id.');
        }
        disposition = { onMembers: 'move_to', targetNodeId };
      } else if (onMembers !== null) {
        throw new AppError(
          'VALIDATION_ERROR',
          'on_members must be unassign, move_to_parent, or move_to.',
        );
      }

      const result = await withWorkspace(context.workspace.id, (tx) =>
        deleteNode(tx, context.workspace.id, id, disposition),
      );
      return { deleted: true, ...result };
    },
    { limit: 'write' },
  );
}
