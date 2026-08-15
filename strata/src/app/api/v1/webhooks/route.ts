import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { handle, parseBody } from '@/server/lib/route';
import { collection } from '@/lib/wire';
import { assertCan } from '@/server/services/permissions.service';
import { createWebhook, listWebhooks } from '@/server/services/webhooks.service';
import { shapeWebhook } from '@/server/lib/webhookWire';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return handle(request, async ({ context }) => {
    assertCan(context.actor, 'webhook.read', { kind: 'webhook' });
    return withWorkspace(context.workspace.id, async (tx) => {
      const rows = await listWebhooks(tx, context.workspace.id);
      return collection(
        rows.map((w) => shapeWebhook(w)),
        { cursor: null, hasMore: false, total: rows.length },
      );
    });
  });
}

const createSchema = z.object({
  url: z.string().url().max(500),
  events: z.array(z.string()).min(1).max(20),
  description: z.string().max(500).optional(),
});

export async function POST(request: Request): Promise<Response> {
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'webhook.create', { kind: 'webhook' });
      const input = await parseBody(request, createSchema);
      return withWorkspace(context.workspace.id, async (tx) => {
        const { webhook, secret } = await createWebhook(
          tx,
          context.workspace.id,
          context.actor.userId,
          input,
        );
        // The secret crosses the wire exactly once, at creation (§9).
        return { ...shapeWebhook(webhook), secret };
      });
    },
    { limit: 'write', status: 201 },
  );
}
