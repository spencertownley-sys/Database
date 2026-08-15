import { and, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { items } from '@/server/db/schema/items';
import { itemTypes, fields as fieldsTable } from '@/server/db/schema/itemTypes';
import { treeNodes } from '@/server/db/schema/trees';
import { handle, parseBody, parseQuery } from '@/server/lib/route';
import { AppError } from '@/server/lib/errors';
import { assertCan } from '@/server/services/permissions.service';
import { applyImmediate } from '@/server/services/changeSets.service';
import { loadItems, loadTreeNodePaths } from '@/server/services/items.service';
import { isInherited } from '@/server/services/variants.service';
import { pathToIds } from '@/server/lib/ltree';
import { uuidSchema } from '@/server/validation/schemas';

export const dynamic = 'force-dynamic';

const getQuerySchema = z.object({
  /** §4: item_type, parent, children, tree_nodes, variant_parent, variants, ancestors. */
  expand: z.string().max(300).optional(),
});

/** `GET /items/:id` — the item, plus `variant_info` when it is a variant (§4). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  return handle(request, async ({ context }) =>
    withWorkspace(context.workspace.id, async (tx) => {
      const query = parseQuery(request, getQuerySchema);
      const expand = new Set(
        (query.expand ?? '').split(',').map((e) => e.trim()).filter(Boolean),
      );

      const [item] = await loadItems(tx, context.workspace.id, [id]);
      if (!item) throw new AppError('NOT_FOUND', 'That item does not exist.');

      const nodePaths = await loadTreeNodePaths(tx, context.workspace.id, [id]);
      assertCan(context.actor, 'item.read', {
        kind: 'item',
        treeNodePaths: nodePaths.get(id) ?? [],
      });

      const out: Record<string, unknown> = { ...item };

      const [type] = await tx
        .select()
        .from(itemTypes)
        .where(and(eq(itemTypes.workspaceId, context.workspace.id), eq(itemTypes.id, item.itemTypeId)))
        .limit(1);
      if (expand.has('item_type')) out.itemType = type ?? null;

      if (item.variantParentId) {
        const [model] = await loadItems(tx, context.workspace.id, [item.variantParentId]);
        const typeFields = await tx
          .select()
          .from(fieldsTable)
          .where(
            and(eq(fieldsTable.itemTypeId, item.itemTypeId), isNull(fieldsTable.deletedAt)),
          );
        const axes = type?.variantAxes ?? [];
        const inherited: string[] = [];
        const overridden: string[] = [];
        for (const f of typeFields) {
          if (axes.includes(f.key)) continue;
          if (isInherited(f.key, item.values, f, axes)) inherited.push(f.key);
          else if (f.inheritance === 'variant') overridden.push(f.key);
        }
        out.variantInfo = {
          variantParentId: item.variantParentId,
          variantParentTitle: model?.title ?? null,
          axisValues: item.variantAxisValues ?? {},
          inheritedFields: inherited,
          overriddenFields: overridden,
          propagating: false,
        };
        if (expand.has('variant_parent')) out.variantParent = model ?? null;
      }

      if (expand.has('parent') && item.parentId) {
        const [parent] = await loadItems(tx, context.workspace.id, [item.parentId]);
        out.parent = parent ?? null;
      }

      if (expand.has('ancestors')) {
        // Every ancestor id is encoded in the ltree path, so the breadcrumb is
        // one indexed lookup rather than a walk.
        const ancestorIds = pathToIds(item.path).filter((aid: string) => aid !== item.id);
        const ancestors = ancestorIds.length
          ? await loadItems(tx, context.workspace.id, ancestorIds)
          : [];
        const byId = new Map(ancestors.map((a) => [a.id, a]));
        out.ancestors = ancestorIds
          .map((aid) => byId.get(aid))
          .filter(Boolean)
          .map((a) => ({ id: a?.id, title: a?.title }));
      }

      if (expand.has('children')) {
        const rows = await tx
          .select({ id: items.id, title: items.title, completenessPct: items.completenessPct })
          .from(items)
          .where(
            and(
              eq(items.workspaceId, context.workspace.id),
              eq(items.parentId, id),
              isNull(items.archivedAt),
            ),
          )
          .orderBy(items.position)
          .limit(200);
        out.children = rows;
      }

      if (expand.has('variants')) {
        const rows = await tx
          .select({ id: items.id, title: items.title, variantAxisValues: items.variantAxisValues })
          .from(items)
          .where(
            and(
              eq(items.workspaceId, context.workspace.id),
              eq(items.variantParentId, id),
              isNull(items.archivedAt),
            ),
          )
          .limit(200);
        out.variants = rows;
      }

      if (expand.has('tree_nodes')) {
        const nodeIds = item.treeNodeIds;
        const rows = nodeIds.length
          ? await tx
              .select({ id: treeNodes.id, label: treeNodes.label, treeId: treeNodes.treeId })
              .from(treeNodes)
              .where(
                and(
                  eq(treeNodes.workspaceId, context.workspace.id),
                  inArray(treeNodes.id, nodeIds),
                ),
              )
          : [];
        out.treeNodes = rows;
      }

      return out;
    }),
  );
}

const patchSchema = z.object({
  title: z.string().max(500).optional(),
  values: z.record(z.unknown()).optional(),
  /** §4: on a variant, deletes the keys — revert-to-inherited, not set-null. */
  revertFields: z.array(z.string()).max(100).optional(),
  parentId: uuidSchema.nullable().optional(),
});

/**
 * `PATCH /items/:id` — partial update through the change-set write path, so a
 * detail-panel edit undoes exactly like a grid edit (§4).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  return handle(
    request,
    async ({ context }) => {
      const input = await parseBody(request, patchSchema);

      const changeContext = {
        workspaceId: context.workspace.id,
        actor: context.actor,
        source: context.actor.apiKey ? ('api' as const) : ('user' as const),
      };

      if (input.revertFields?.length) {
        await applyImmediate(changeContext, {
          operation: 'clear_field',
          target: { kind: 'ids', itemIds: [id] },
          patch: { fieldKeys: input.revertFields },
        });
      }

      let changeSetId: string | null = null;
      if (input.values || input.title !== undefined) {
        const result = await applyImmediate(changeContext, {
          operation: 'set_field',
          target: { kind: 'ids', itemIds: [id] },
          patch: {
            ...(input.title !== undefined ? { title: input.title } : {}),
            values: input.values ?? {},
          },
        });
        changeSetId = result.changeSet.id;
      }

      if (input.parentId !== undefined) {
        const result = await applyImmediate(changeContext, {
          operation: 'reparent',
          target: { kind: 'ids', itemIds: [id] },
          patch: { itemId: id, parentId: input.parentId },
        });
        changeSetId = result.changeSet.id;
      }

      return withWorkspace(context.workspace.id, async (tx) => {
        const [item] = await loadItems(tx, context.workspace.id, [id]);
        if (!item) throw new AppError('NOT_FOUND', 'That item does not exist.');
        return { ...item, meta: { changeSetId } };
      });
    },
    { limit: 'write' },
  );
}

/** `DELETE /items/:id` — archive via a change set; `?cascade=true` for children (§4). */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  return handle(
    request,
    async ({ context }) => {
      const url = new URL(request.url);
      const cascade = url.searchParams.get('cascade') === 'true';

      const childCount = await withWorkspace(context.workspace.id, async (tx) => {
        const rows = await tx
          .select({ id: items.id })
          .from(items)
          .where(
            and(
              eq(items.workspaceId, context.workspace.id),
              eq(items.parentId, id),
              isNull(items.archivedAt),
            ),
          )
          .limit(1);
        return rows.length;
      });

      if (childCount > 0 && !cascade) {
        throw new AppError(
          'HAS_CHILDREN',
          'This item has sub-items. Pass ?cascade=true to archive them together.',
          { cascade: false },
        );
      }

      const result = await applyImmediate(
        {
          workspaceId: context.workspace.id,
          actor: context.actor,
          source: context.actor.apiKey ? 'api' : 'user',
        },
        {
          operation: 'delete',
          target: { kind: 'ids', itemIds: [id], includeDescendants: cascade },
        },
      );

      return {
        id,
        archivedAt: new Date(),
        changeSetId: result.changeSet.id,
        cascadedCount: result.appliedCount - 1,
      };
    },
    { limit: 'write' },
  );
}
