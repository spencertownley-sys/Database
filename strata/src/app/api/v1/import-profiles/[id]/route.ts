import { withWorkspace } from '@/server/db';
import { handle } from '@/server/lib/route';
import { assertCan } from '@/server/services/permissions.service';
import { deleteProfile } from '@/server/services/imports.service';

export const dynamic = 'force-dynamic';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'import.create', { kind: 'import' });
      await withWorkspace(context.workspace.id, (tx) =>
        deleteProfile(tx, context.workspace.id, id),
      );
      return { deleted: true };
    },
    { limit: 'write' },
  );
}
