import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { handle, idempotencyKeyOf, parseBody } from '@/server/lib/route';
import { shapeChangeSet } from '@/server/lib/changeSetWire';
import { assertCan } from '@/server/services/permissions.service';
import { planVariantGeneration } from '@/server/services/items.service';
import {
  commitChangeSet,
  previewChangeSet,
} from '@/server/services/changeSets.service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  /** `{ region: ["emea", "apac"] }` — option ids per declared axis. */
  axisValues: z.record(z.string(), z.array(z.string().min(1)).min(1).max(200)),
  /** §4: previewing is the default; creating is the explicit choice. */
  preview: z.boolean().optional().default(true),
});

/**
 * `POST /items/:id/generate-variants` — guided generation as one change set
 * (API Design §4). `preview: true` returns the change-set preview (200);
 * `preview: false` creates the variants (201).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  // `handle` fixes the response status up front, so the preview/create split
  // is read from a clone before the body is consumed by validation.
  const peek = (await request
    .clone()
    .json()
    .catch(() => ({}))) as { preview?: unknown };
  const wantsPreview = peek.preview !== false;

  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'item.create', { kind: 'item', treeNodePaths: [] });
      const input = await parseBody(request, bodySchema);

      return withWorkspace(context.workspace.id, async (tx) => {
        const changeContext = {
          workspaceId: context.workspace.id,
          actor: context.actor,
          source: context.actor.apiKey ? ('api' as const) : ('user' as const),
          idempotencyKey: idempotencyKeyOf(request),
        };

        const plan = await planVariantGeneration(tx, context.workspace.id, id, input.axisValues);
        const generation = {
          adding: plan.adding,
          skippedExisting: plan.skippedExisting,
          existingCount: plan.existingCount,
        };

        const { changeSet, requiresAsyncCommit } = await previewChangeSet(tx, changeContext, {
          operation: 'create',
          itemTypeId: plan.itemTypeId,
          target: { kind: 'new', drafts: plan.drafts },
        });

        if (input.preview || requiresAsyncCommit) {
          return { ...shapeChangeSet(changeSet), requiresAsyncCommit, generation };
        }

        const result = await commitChangeSet(tx, changeContext, changeSet.id);
        return {
          ...shapeChangeSet(result.changeSet),
          committed: true,
          appliedCount: result.appliedCount,
          skippedCount: result.skippedCount,
          generation,
        };
      });
    },
    { limit: 'write', status: wantsPreview ? 200 : 201 },
  );
}
