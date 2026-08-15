import { and, eq } from 'drizzle-orm';
import { withWorkspace } from '@/server/db';
import { changeEntries } from '@/server/db/schema/changeSets';
import { handle } from '@/server/lib/route';
import { discardPreview, getChangeSet } from '@/server/services/changeSets.service';
import { shapeChangeSet } from '@/server/lib/changeSetWire';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  return handle(request, async ({ context }) =>
    withWorkspace(context.workspace.id, async (tx) => {
      const changeSet = await getChangeSet(tx, context.workspace.id, id);

      // The preview modal renders from `sampleEntries` and `summary`; full
      // entries are fetched only when someone expands the list, so a 40k-row
      // change set does not ship 40k rows to render a headline.
      const url = new URL(request.url);
      if (url.searchParams.get('entries') !== 'all') {
        return { ...shapeChangeSet(changeSet), truncated: changeSet.itemCount > 20 };
      }

      const entries = await tx
        .select()
        .from(changeEntries)
        .where(
          and(
            eq(changeEntries.workspaceId, context.workspace.id),
            eq(changeEntries.changeSetId, id),
          ),
        )
        .orderBy(changeEntries.seq)
        .limit(1000);

      return { ...shapeChangeSet(changeSet), entries, truncated: changeSet.itemCount > 1000 };
    }),
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  return handle(
    request,
    async ({ context }) =>
      withWorkspace(context.workspace.id, async (tx) => {
        await discardPreview(tx, context.workspace.id, id);
        return { discarded: true };
      }),
    { limit: 'write' },
  );
}
