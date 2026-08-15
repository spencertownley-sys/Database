import { withWorkspace } from '@/server/db';
import { handle } from '@/server/lib/route';
import { commitChangeSet, getChangeSet } from '@/server/services/changeSets.service';
import { assertCan } from '@/server/services/permissions.service';
import { shapeChangeSet } from '@/server/lib/changeSetWire';

export const dynamic = 'force-dynamic';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'change_set.commit', { kind: 'change_set' });

      return withWorkspace(context.workspace.id, async (tx) => {
        // Read first so the response can say what was applied even when the
        // set is large; the service re-reads inside its own transaction.
        await getChangeSet(tx, context.workspace.id, id);

        const result = await commitChangeSet(
          tx,
          {
            workspaceId: context.workspace.id,
            actor: context.actor,
            source: context.actor.apiKey ? 'api' : 'user',
          },
          id,
        );

        return {
          ...shapeChangeSet(result.changeSet),
          appliedCount: result.appliedCount,
          skippedCount: result.skippedCount,
          variantsPropagated: result.variantsPropagated,
        };
      });
    },
    { limit: 'bulk' },
  );
}
