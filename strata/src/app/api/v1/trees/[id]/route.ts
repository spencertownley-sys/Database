import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { handle, parseBody } from '@/server/lib/route';
import { assertCan } from '@/server/services/permissions.service';
import { deleteTree, updateTree } from '@/server/services/trees.service';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'tree.update', { kind: 'tree' });
      const input = await parseBody(request, patchSchema);
      return withWorkspace(context.workspace.id, (tx) =>
        updateTree(tx, context.workspace.id, id, input),
      );
    },
    { limit: 'write' },
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'tree.delete', { kind: 'tree' });
      await withWorkspace(context.workspace.id, (tx) =>
        deleteTree(tx, context.workspace.id, id),
      );
      return { deleted: true };
    },
    { limit: 'write' },
  );
}
