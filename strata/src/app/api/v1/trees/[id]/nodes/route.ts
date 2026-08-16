import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { handle, parseBody } from '@/server/lib/route';
import { collection } from '@/lib/wire';
import { assertCan } from '@/server/services/permissions.service';
import { createNode, listNodes } from '@/server/services/trees.service';
import { uuidSchema } from '@/server/validation/schemas';

export const dynamic = 'force-dynamic';

/** `GET /trees/:id/nodes` — the whole tree with counts and rollups (§6). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handle(request, async ({ context }) => {
    assertCan(context.actor, 'tree.read', { kind: 'tree' });
    return withWorkspace(context.workspace.id, async (tx) => {
      const rows = await listNodes(tx, context.workspace.id, id);
      return collection(rows, { cursor: null, hasMore: false, total: rows.length });
    });
  });
}

const createSchema = z.object({
  label: z.string().min(1).max(200),
  parentId: uuidSchema.nullable().optional(),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'tree_node.create', { kind: 'tree' });
      const input = await parseBody(request, createSchema);
      return withWorkspace(context.workspace.id, (tx) =>
        createNode(tx, context.workspace.id, id, input),
      );
    },
    { limit: 'write', status: 201 },
  );
}
