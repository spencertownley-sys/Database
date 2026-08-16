import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { handle, parseBody } from '@/server/lib/route';
import { assertCan } from '@/server/services/permissions.service';
import { runExport } from '@/server/services/exports.service';
import { filterGroupSchema, sortSchema, uuidSchema } from '@/server/validation/schemas';
import type { FilterGroup, SortSpec } from '@/types/filters';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  itemTypeId: uuidSchema,
  filter: filterGroupSchema.optional(),
  sort: z.array(sortSchema).max(3).optional(),
  search: z.string().max(200).optional(),
  incompleteOnly: z.boolean().optional(),
  visibleFieldKeys: z.array(z.string()).max(100).optional(),
  includeVariants: z.boolean().optional(),
  format: z.enum(['csv']).optional().default('csv'),
});

/**
 * `POST /exports` — generated synchronously in this build (no job runner);
 * always answers the §8 "ready" shape with a signed download URL.
 */
export async function POST(request: Request): Promise<Response> {
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'export.create', { kind: 'export' });
      const input = await parseBody(request, bodySchema);

      return withWorkspace(context.workspace.id, async (tx) => {
        const { job, downloadUrl } = await runExport(tx, context.workspace.id, context.actor.userId, {
          itemTypeId: input.itemTypeId,
          filter: input.filter as FilterGroup | undefined,
          sort: input.sort as SortSpec[] | undefined,
          search: input.search,
          incompleteOnly: input.incompleteOnly,
          visibleFieldKeys: input.visibleFieldKeys,
          includeVariants: input.includeVariants,
        });
        return {
          id: job.id,
          status: job.status,
          rowCount: job.rowCount,
          downloadUrl,
          expiresAt: job.expiresAt,
        };
      });
    },
    { limit: 'write' },
  );
}
