import { handle } from '@/server/lib/route';
import { assertCan } from '@/server/services/permissions.service';
import { sendTestEvent } from '@/server/services/webhooks.service';

export const dynamic = 'force-dynamic';

/** `POST /webhooks/:id/test` — a signed synthetic delivery, same code path. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'webhook.update', { kind: 'webhook' });
      await sendTestEvent(context.workspace.id, id);
      return { sent: true };
    },
    { limit: 'write' },
  );
}
