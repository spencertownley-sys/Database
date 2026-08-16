import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { handle, parseBody } from '@/server/lib/route';
import { AppError } from '@/server/lib/errors';
import { markNotificationsRead } from '@/server/services/notifications.service';
import { uuidSchema } from '@/server/validation/schemas';

export const dynamic = 'force-dynamic';

const bodySchema = z.union([
  z.object({ ids: z.array(uuidSchema).min(1).max(200) }),
  z.object({ all: z.literal(true) }),
]);

/** `POST /notifications/read` — `{ids: [...]}` or `{all: true}` (§9). */
export async function POST(request: Request): Promise<Response> {
  return handle(
    request,
    async ({ context }) => {
      const userId = context.actor.userId;
      if (!userId) throw new AppError('FORBIDDEN', 'API keys have no notification inbox.');
      const input = await parseBody(request, bodySchema);
      const marked = await withWorkspace(context.workspace.id, (tx) =>
        markNotificationsRead(tx, context.workspace.id, userId, input),
      );
      return { markedRead: marked };
    },
    { limit: 'write' },
  );
}
