import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { handle, parseBody } from '@/server/lib/route';
import { assertCan } from '@/server/services/permissions.service';
import { deleteWebhook, updateWebhook } from '@/server/services/webhooks.service';
import { shapeWebhook } from '@/server/lib/webhookWire';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  url: z.string().url().max(500).optional(),
  events: z.array(z.string()).min(1).max(20).optional(),
  description: z.string().max(500).optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'webhook.update', { kind: 'webhook' });
      const input = await parseBody(request, patchSchema);
      return withWorkspace(context.workspace.id, async (tx) =>
        shapeWebhook(await updateWebhook(tx, context.workspace.id, id, input)),
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
      assertCan(context.actor, 'webhook.delete', { kind: 'webhook' });
      await withWorkspace(context.workspace.id, (tx) =>
        deleteWebhook(tx, context.workspace.id, id),
      );
      return { deleted: true };
    },
    { limit: 'write' },
  );
}
