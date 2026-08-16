import { withWorkspace } from '@/server/db';
import { handle } from '@/server/lib/route';
import { shapeImportJob } from '@/server/lib/importWire';
import { assertCan } from '@/server/services/permissions.service';
import { getImportJob } from '@/server/services/imports.service';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handle(request, async ({ context }) => {
    assertCan(context.actor, 'import.create', { kind: 'import' });
    return withWorkspace(context.workspace.id, async (tx) =>
      shapeImportJob(await getImportJob(tx, context.workspace.id, id), context.workspace.id),
    );
  });
}
