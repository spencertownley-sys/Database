import { withWorkspace } from '@/server/db';
import { handle } from '@/server/lib/route';
import { collection } from '@/lib/wire';
import { assertCan } from '@/server/services/permissions.service';
import { listDeliveries } from '@/server/services/webhooks.service';

export const dynamic = 'force-dynamic';

/** `GET /webhooks/:id/deliveries` — recent attempts, for debugging (§12). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handle(request, async ({ context }) => {
    assertCan(context.actor, 'webhook.read', { kind: 'webhook' });
    return withWorkspace(context.workspace.id, async (tx) => {
      const rows = await listDeliveries(tx, context.workspace.id, id);
      return collection(rows, { cursor: null, hasMore: false, total: rows.length });
    });
  });
}
