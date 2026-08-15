import { withWorkspace } from '@/server/db';
import { handle, idempotencyKeyOf } from '@/server/lib/route';
import { shapeImportJob } from '@/server/lib/importWire';
import { assertCan } from '@/server/services/permissions.service';
import {
  buildImportDrafts,
  getImportJob,
  markCommitted,
} from '@/server/services/imports.service';
import {
  commitChangeSet,
  previewChangeSet,
} from '@/server/services/changeSets.service';

export const dynamic = 'force-dynamic';

/**
 * `POST /imports/:id/commit` — the whole import as one change set, committed
 * synchronously (this build has no job runner), so `change_set_id` is
 * immediately undoable via `POST /change-sets/:id/undo`.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'import.commit', { kind: 'import' });

      return withWorkspace(context.workspace.id, async (tx) => {
        const job = await getImportJob(tx, context.workspace.id, id);
        const drafts = await buildImportDrafts(tx, context.workspace.id, job);

        const changeContext = {
          workspaceId: context.workspace.id,
          actor: context.actor,
          source: 'import' as const,
          idempotencyKey: idempotencyKeyOf(request),
        };

        const { changeSet } = await previewChangeSet(tx, changeContext, {
          operation: 'create',
          itemTypeId: job.itemTypeId,
          target: { kind: 'new', drafts },
        });
        const result = await commitChangeSet(tx, changeContext, changeSet.id);
        const committed = await markCommitted(tx, context.workspace.id, job.id, changeSet.id);

        return {
          ...shapeImportJob(committed, context.workspace.id),
          appliedCount: result.appliedCount,
          skippedCount: result.skippedCount,
        };
      });
    },
    { limit: 'write' },
  );
}
