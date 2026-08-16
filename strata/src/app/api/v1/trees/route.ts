import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { handle, parseBody } from '@/server/lib/route';
import { collection } from '@/lib/wire';
import { assertCan } from '@/server/services/permissions.service';
import { createTree, listTrees } from '@/server/services/trees.service';

export const dynamic = 'force-dynamic';

/** `GET /trees` — every live tree with its node count (§6). */
export async function GET(request: Request): Promise<Response> {
  return handle(request, async ({ context }) => {
    assertCan(context.actor, 'tree.read', { kind: 'tree' });
    return withWorkspace(context.workspace.id, async (tx) => {
      const rows = await listTrees(tx, context.workspace.id);
      return collection(rows, { cursor: null, hasMore: false, total: rows.length });
    });
  });
}

const createSchema = z.object({
  label: z.string().min(1).max(120),
  key: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,62}$/)
    .optional(),
  description: z.string().max(1000).optional(),
});

/** `POST /trees` — admin only; v1 caps custom trees (TREE_LIMIT_REACHED). */
export async function POST(request: Request): Promise<Response> {
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'tree.create', { kind: 'tree' });
      const input = await parseBody(request, createSchema);
      return withWorkspace(context.workspace.id, (tx) =>
        createTree(tx, context.workspace.id, input),
      );
    },
    { limit: 'write', status: 201 },
  );
}
