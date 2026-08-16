import { withWorkspace } from '@/server/db';
import { handle } from '@/server/lib/route';
import { undoChangeSet } from '@/server/services/changeSets.service';
import { emitUndone } from '@/server/lib/webhookEmit';

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
    async ({ context }) => {
      const result = await withWorkspace(context.workspace.id, (tx) =>
        undoChangeSet(
          tx,
          {
            workspaceId: context.workspace.id,
            actor: context.actor,
            source: 'undo',
          },
          id,
        ),
      );
      emitUndone(context.workspace.id, id, result.changeSet.id);
      // §5: the undo response names both sets and reports what was restored.
      return {
        undoChangeSetId: result.changeSet.id,
        originalChangeSetId: id,
        status: result.changeSet.status,
        itemCount: result.changeSet.itemCount,
        restored: result.appliedCount,
        variantsPropagated: result.variantsPropagated,
      };
    },
    { limit: 'bulk' },
  );
}
