import { withWorkspace } from '@/server/db';
import { handle } from '@/server/lib/route';
import { assertCan } from '@/server/services/permissions.service';
import { downloadUrlFor, getExportJob } from '@/server/services/exports.service';

export const dynamic = 'force-dynamic';

/** `GET /exports/:id` — status plus a freshly signed download URL. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handle(request, async ({ context }) => {
    assertCan(context.actor, 'export.create', { kind: 'export' });
    return withWorkspace(context.workspace.id, async (tx) => {
      const job = await getExportJob(tx, context.workspace.id, id);
      const expired = job.expiresAt !== null && job.expiresAt.getTime() < Date.now();
      return {
        id: job.id,
        status: expired ? 'expired' : job.status,
        rowCount: job.rowCount,
        downloadUrl: job.status === 'ready' && !expired ? downloadUrlFor(job) : null,
        expiresAt: job.expiresAt,
      };
    });
  });
}
