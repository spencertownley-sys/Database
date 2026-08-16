import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { handle, parseBody, parseQuery } from '@/server/lib/route';
import { collection } from '@/lib/wire';
import { assertCan } from '@/server/services/permissions.service';
import { listProfiles } from '@/server/services/imports.service';
import { importProfiles } from '@/server/db/schema/imports';
import { uuidSchema } from '@/server/validation/schemas';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return handle(request, async ({ context }) => {
    assertCan(context.actor, 'import.create', { kind: 'import' });
    const query = parseQuery(request, z.object({ itemTypeId: uuidSchema.optional() }));
    return withWorkspace(context.workspace.id, async (tx) => {
      const rows = await listProfiles(tx, context.workspace.id, query.itemTypeId);
      return collection(rows, { cursor: null, hasMore: false, total: rows.length });
    });
  });
}

const createSchema = z.object({
  itemTypeId: uuidSchema,
  name: z.string().min(1).max(120),
  mapping: z.record(z.string(), z.string().min(1)),
  matchKey: z.string().nullable().optional(),
  options: z
    .object({
      hasHeaderRow: z.boolean().optional(),
      onMatch: z.enum(['update', 'skip']).optional(),
    })
    .optional(),
});

export async function POST(request: Request): Promise<Response> {
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'import.create', { kind: 'import' });
      const input = await parseBody(request, createSchema);
      return withWorkspace(context.workspace.id, async (tx) => {
        const [created] = await tx
          .insert(importProfiles)
          .values({
            workspaceId: context.workspace.id,
            itemTypeId: input.itemTypeId,
            name: input.name,
            mapping: input.mapping,
            matchKey: input.matchKey ?? null,
            options: input.options ?? {},
            createdBy: context.actor.userId,
          })
          .onConflictDoUpdate({
            target: [importProfiles.workspaceId, importProfiles.itemTypeId, importProfiles.name],
            set: {
              mapping: input.mapping,
              matchKey: input.matchKey ?? null,
              options: input.options ?? {},
              updatedAt: new Date(),
            },
          })
          .returning();
        return created;
      });
    },
    { limit: 'write', status: 201 },
  );
}
