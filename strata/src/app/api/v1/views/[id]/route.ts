import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { handle, parseBody } from '@/server/lib/route';
import { assertCan } from '@/server/services/permissions.service';
import { deleteView, getView, updateView } from '@/server/services/views.service';
import { shapeView } from '@/server/lib/viewWire';
import { viewConfigSchema } from '@/server/validation/schemas';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handle(request, async ({ context }) => {
    assertCan(context.actor, 'view.read', { kind: 'view' });
    return withWorkspace(context.workspace.id, async (tx) =>
      shapeView(await getView(tx, context.workspace.id, id, context.actor.userId)),
    );
  });
}

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).optional(),
  visibility: z.enum(['private', 'workspace', 'shared']).optional(),
  config: viewConfigSchema.optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handle(
    request,
    async ({ context }) => {
      const input = await parseBody(request, patchSchema);
      // Sharing is its own permission — making a link the whole internet can
      // open is a bigger decision than renaming a lens.
      assertCan(
        context.actor,
        input.visibility === 'shared' ? 'view.share' : 'view.update',
        { kind: 'view' },
      );
      return withWorkspace(context.workspace.id, async (tx) =>
        shapeView(await updateView(tx, context.workspace.id, context.actor.userId, id, input)),
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
      assertCan(context.actor, 'view.delete', { kind: 'view' });
      await withWorkspace(context.workspace.id, (tx) =>
        deleteView(tx, context.workspace.id, context.actor.userId, id),
      );
      return { deleted: true };
    },
    { limit: 'write' },
  );
}
