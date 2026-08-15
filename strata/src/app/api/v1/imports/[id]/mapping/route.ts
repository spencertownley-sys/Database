import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { handle, parseBody } from '@/server/lib/route';
import { shapeImportJob } from '@/server/lib/importWire';
import { assertCan } from '@/server/services/permissions.service';
import { setMappingAndValidate } from '@/server/services/imports.service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /** Source column header → field key, `"title"`, or `"$skip"`. */
  mapping: z.record(z.string(), z.string().min(1)),
  matchKey: z.string().nullable().optional(),
  options: z
    .object({
      hasHeaderRow: z.boolean().optional(),
      onMatch: z.enum(['update', 'skip']).optional(),
      treeNodeId: z.string().uuid().optional(),
      parentItemId: z.string().uuid().optional(),
    })
    .optional(),
  saveAsProfile: z.string().min(1).max(120).optional(),
});

/** `PATCH /imports/:id/mapping` — sets the mapping and runs the dry-run now. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'import.create', { kind: 'import' });
      const input = await parseBody(request, bodySchema);
      return withWorkspace(context.workspace.id, async (tx) => {
        const job = await setMappingAndValidate(tx, context.workspace.id, context.actor.userId, id, input);
        return shapeImportJob(job, context.workspace.id);
      });
    },
    { limit: 'write' },
  );
}
