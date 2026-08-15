import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { handle, parseQuery } from '@/server/lib/route';
import { collection } from '@/lib/wire';
import { AppError } from '@/server/lib/errors';
import { listNotifications } from '@/server/services/notifications.service';
import { notificationKindEnum } from '@/server/db/schema/notifications';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  unreadOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  kind: z.enum(notificationKindEnum.enumValues).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export async function GET(request: Request): Promise<Response> {
  return handle(request, async ({ context }) => {
    const userId = context.actor.userId;
    if (!userId) throw new AppError('FORBIDDEN', 'API keys have no notification inbox.');
    const query = parseQuery(request, querySchema);
    return withWorkspace(context.workspace.id, async (tx) => {
      const { rows, nextCursor, unreadCount } = await listNotifications(
        tx,
        context.workspace.id,
        userId,
        query,
      );
      return {
        ...collection(rows, { cursor: nextCursor, hasMore: nextCursor !== null, total: null }),
        unreadCount,
      };
    });
  });
}
