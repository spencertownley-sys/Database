import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { handle, parseBody, parseQuery } from '@/server/lib/route';
import { collection } from '@/lib/wire';
import { assertCan } from '@/server/services/permissions.service';
import { createView, listViews } from '@/server/services/views.service';
import { shapeView } from '@/server/lib/viewWire';
import { uuidSchema, viewConfigSchema } from '@/server/validation/schemas';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return handle(request, async ({ context }) => {
    assertCan(context.actor, 'view.read', { kind: 'view' });
    const query = parseQuery(request, z.object({ itemTypeId: uuidSchema.optional() }));
    return withWorkspace(context.workspace.id, async (tx) => {
      const rows = await listViews(tx, context.workspace.id, context.actor.userId, query.itemTypeId);
      return collection(
        rows.map((v) => shapeView(v)),
        { cursor: null, hasMore: false, total: rows.length },
      );
    });
  });
}

const createSchema = z.object({
  itemTypeId: uuidSchema,
  name: z.string().min(1).max(120),
  type: z.enum(['grid', 'list', 'board']).optional(),
  description: z.string().max(1000).optional(),
  visibility: z.enum(['private', 'workspace', 'shared']).optional(),
  config: viewConfigSchema.optional(),
});

export async function POST(request: Request): Promise<Response> {
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'view.create', { kind: 'view' });
      const input = await parseBody(request, createSchema);
      return withWorkspace(context.workspace.id, async (tx) => {
        const view = await createView(tx, context.workspace.id, context.actor.userId, input);
        return shapeView(view);
      });
    },
    { limit: 'write', status: 201 },
  );
}
