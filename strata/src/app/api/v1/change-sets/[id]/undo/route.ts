import { withWorkspace } from '@/server/db';
import { handle } from '@/server/lib/route';
import { undoChangeSet } from '@/server/services/changeSets.service';

export const dynamic = 'force-dynamic';

/**
 * Undo. The per-actor rule ("you may undo your own changes; admins may undo
 * anyone's") lives in `can()` and is applied inside the service, because it
 * depends on the change set's own `actor_id` — which the route has not loaded.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  return handle(
    request,
    async ({ context }) =>
      withWorkspace(context.workspace.id, async (tx) => {
        const result = await undoChangeSet(
          tx,
          {
            workspaceId: context.workspace.id,
            actor: context.actor,
            source: 'undo',
          },
          id,
        );
        return {
          changeSet: result.changeSet,
          restoredCount: result.appliedCount,
          variantsPropagated: result.variantsPropagated,
        };
      }),
    { limit: 'bulk' },
  );
}
