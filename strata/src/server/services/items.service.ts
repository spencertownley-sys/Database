/**
 * Item state: snapshots, derived-value recomputation, and the appliers the
 * change-set path uses.
 *
 * Nothing here is a public write API. Every mutation reaches these functions
 * through `changeSets.service.ts`, because a write that skips the change set
 * has no preview, no undo, and no activity record — which in this product is
 * indistinguishable from data loss.
 *
 * **Change entries store input state, not diffs.** An entry carries a complete
 * `ItemSnapshot` of the mutable columns before and after. Derived columns
 * (`effective_values`, `completeness_pct`, `missing_required`, `search_text`,
 * and the projection index) are deliberately *not* stored: they are recomputed
 * from the snapshot on both apply and undo, which is what makes undo produce a
 * byte-identical state rather than an approximately-identical one. Storing
 * derived values would let a schema change between commit and undo restore a
 * value that no longer matches its own inputs.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Tx } from '@/server/db';
import { items, itemFieldIndex, type Item, type ItemValues, type InvalidValues } from '@/server/db/schema/items';
import { itemTreeNodes, treeNodes } from '@/server/db/schema/trees';
import { itemTypes, type Field } from '@/server/db/schema/itemTypes';
import { AppError } from '@/server/lib/errors';
import { assertDepthAfterMove, assertNoCycle, childPath, pathDepth } from '@/server/lib/ltree';
import { computeCompleteness } from './completeness.service';
import { computeEffectiveValues, ownEffectiveValues } from './variants.service';
import {
  buildSearchText,
  removeProjection,
  syncProjection,
  type IndexableField,
} from '@/server/search/projection';

export interface ItemSnapshot {
  id: string;
  itemTypeId: string;
  title: string;
  parentId: string | null;
  path: string;
  orderKey: string;
  isVariantModel: boolean;
  variantOfId: string | null;
  variantAxisValues: Record<string, string> | null;
  values: ItemValues;
  invalidValues: InvalidValues;
  assigneeId: string | null;
  /** Sorted, so two snapshots of the same state compare equal. */
  treeNodeIds: string[];
  deleted: boolean;
}

export interface LoadedItem extends Item {
  treeNodeIds: string[];
}

export function snapshotOf(item: LoadedItem): ItemSnapshot {
  return {
    id: item.id,
    itemTypeId: item.itemTypeId,
    title: item.title,
    parentId: item.parentId,
    path: item.path,
    orderKey: item.orderKey,
    isVariantModel: item.isVariantModel,
    variantOfId: item.variantOfId,
    variantAxisValues: item.variantAxisValues,
    values: item.values,
    invalidValues: item.invalidValues,
    assigneeId: item.assigneeId,
    treeNodeIds: [...item.treeNodeIds].sort(),
    deleted: item.deletedAt !== null,
  };
}

// ---------------------------------------------------------------------------
// loading
// ---------------------------------------------------------------------------

export async function loadItems(
  tx: Tx,
  workspaceId: string,
  itemIds: readonly string[],
  opts: { includeDeleted?: boolean } = {},
): Promise<LoadedItem[]> {
  if (itemIds.length === 0) return [];

  const rows = await tx
    .select()
    .from(items)
    .where(
      and(
        eq(items.workspaceId, workspaceId),
        inArray(items.id, [...itemIds]),
        opts.includeDeleted ? undefined : isNull(items.deletedAt),
      ),
    );

  const memberships = await tx
    .select({ itemId: itemTreeNodes.itemId, treeNodeId: itemTreeNodes.treeNodeId })
    .from(itemTreeNodes)
    .where(
      and(eq(itemTreeNodes.workspaceId, workspaceId), inArray(itemTreeNodes.itemId, [...itemIds])),
    );

  const byItem = new Map<string, string[]>();
  for (const m of memberships) {
    const list = byItem.get(m.itemId);
    if (list) list.push(m.treeNodeId);
    else byItem.set(m.itemId, [m.treeNodeId]);
  }

  return rows.map((row) => ({ ...row, treeNodeIds: byItem.get(row.id) ?? [] }));
}

/** ltree paths of every tree node an item belongs to — the guest scope check. */
export async function loadTreeNodePaths(
  tx: Tx,
  workspaceId: string,
  itemIds: readonly string[],
): Promise<Map<string, string[]>> {
  if (itemIds.length === 0) return new Map();

  const rows = await tx
    .select({ itemId: itemTreeNodes.itemId, path: treeNodes.path })
    .from(itemTreeNodes)
    .innerJoin(treeNodes, eq(treeNodes.id, itemTreeNodes.treeNodeId))
    .where(
      and(eq(itemTreeNodes.workspaceId, workspaceId), inArray(itemTreeNodes.itemId, [...itemIds])),
    );

  const out = new Map<string, string[]>();
  for (const row of rows) {
    const list = out.get(row.itemId);
    if (list) list.push(row.path);
    else out.set(row.itemId, [row.path]);
  }
  // An item in no tree still needs an entry, or a guest check reads it as
  // "paths not loaded" and throws.
  for (const id of itemIds) if (!out.has(id)) out.set(id, []);
  return out;
}

export async function loadSubtreeIds(
  tx: Tx,
  workspaceId: string,
  rootItemId: string,
): Promise<string[]> {
  const [root] = await tx
    .select({ path: items.path })
    .from(items)
    .where(and(eq(items.workspaceId, workspaceId), eq(items.id, rootItemId)))
    .limit(1);

  if (!root) throw new AppError('NOT_FOUND', 'That item no longer exists.');

  // `path <@ :root` is an indexed GiST containment test — a recursive CTE here
  // would walk the tree row by row for the same answer.
  const rows = await tx
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.workspaceId, workspaceId),
        isNull(items.deletedAt),
        sql`${items.path} <@ ${root.path}::ltree`,
      ),
    );

  return rows.map((r) => r.id);
}

/** Every variant of the given models, for propagation. */
export async function loadVariantsOf(
  tx: Tx,
  workspaceId: string,
  modelIds: readonly string[],
): Promise<LoadedItem[]> {
  if (modelIds.length === 0) return [];
  const rows = await tx
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.workspaceId, workspaceId),
        inArray(items.variantOfId, [...modelIds]),
        isNull(items.deletedAt),
      ),
    );
  return loadItems(
    tx,
    workspaceId,
    rows.map((r) => r.id),
  );
}

// ---------------------------------------------------------------------------
// derived values
// ---------------------------------------------------------------------------

export interface DerivedValues {
  effectiveValues: ItemValues;
  completenessPct: number;
  missingRequired: string[];
  searchText: string;
}

export function computeDerived(
  snapshot: ItemSnapshot,
  fields: readonly Field[],
  modelValues: ItemValues | null,
  variantAxes: readonly string[] = [],
): DerivedValues {
  const effectiveValues =
    snapshot.variantOfId && modelValues
      ? computeEffectiveValues(modelValues, snapshot.values, fields, variantAxes).values
      : ownEffectiveValues(snapshot.values, fields);

  const completeness = computeCompleteness({
    effectiveValues,
    fields,
    invalidValues: snapshot.invalidValues,
  });

  return {
    effectiveValues,
    completenessPct: completeness.pct,
    missingRequired: completeness.missingRequired,
    searchText: buildSearchText(snapshot.title, effectiveValues, fields),
  };
}

// ---------------------------------------------------------------------------
// hierarchy
// ---------------------------------------------------------------------------

/**
 * Moves a subtree in one statement.
 *
 * `path = :newParentPath || subpath(path, nlevel(:oldPath) - 1)` rewrites the
 * moving node and every descendant together. Walking children in application
 * code would be O(n) round trips and would leave the tree inconsistent if the
 * process died halfway.
 */
export async function reparentSubtree(
  tx: Tx,
  workspaceId: string,
  itemId: string,
  newParentId: string | null,
): Promise<void> {
  const [moving] = await tx
    .select({ path: items.path, parentId: items.parentId, variantOfId: items.variantOfId, isVariantModel: items.isVariantModel })
    .from(items)
    .where(and(eq(items.workspaceId, workspaceId), eq(items.id, itemId)))
    .limit(1);

  if (!moving) throw new AppError('NOT_FOUND', 'That item no longer exists.');

  if (moving.variantOfId !== null) {
    throw new AppError(
      'VARIANT_CONSTRAINT',
      'Variants live outside the work hierarchy. Move the product instead.',
    );
  }

  let newParentPath: string | null = null;
  if (newParentId !== null) {
    const [parent] = await tx
      .select({ path: items.path, variantOfId: items.variantOfId, isVariantModel: items.isVariantModel })
      .from(items)
      .where(and(eq(items.workspaceId, workspaceId), eq(items.id, newParentId), isNull(items.deletedAt)))
      .limit(1);

    if (!parent) throw new AppError('NOT_FOUND', 'The destination item no longer exists.');
    if (parent.isVariantModel) {
      throw new AppError(
        'VARIANT_CONSTRAINT',
        'A product with variants cannot contain other items.',
      );
    }
    if (parent.variantOfId !== null) {
      throw new AppError('VARIANT_CONSTRAINT', 'A variant cannot contain other items.');
    }
    newParentPath = parent.path;
    assertNoCycle(moving.path, newParentPath);
  }

  const [deepest] = await tx
    .select({ depth: sql<number>`coalesce(max(nlevel(${items.path})), 0)::int` })
    .from(items)
    .where(
      and(eq(items.workspaceId, workspaceId), sql`${items.path} <@ ${moving.path}::ltree`),
    );

  assertDepthAfterMove(
    deepest?.depth ?? pathDepth(moving.path),
    pathDepth(moving.path),
    newParentPath ? pathDepth(newParentPath) : 0,
  );

  const newPath = childPath(newParentPath, itemId);

  await tx.execute(sql`
    update items
    set path = ${newPath}::ltree || subpath(path, nlevel(${moving.path}::ltree)),
        updated_at = now()
    where workspace_id = ${workspaceId}
      and path <@ ${moving.path}::ltree
  `);

  await tx
    .update(items)
    .set({ parentId: newParentId, updatedAt: new Date() })
    .where(and(eq(items.workspaceId, workspaceId), eq(items.id, itemId)));
}

// ---------------------------------------------------------------------------
// applying snapshots
// ---------------------------------------------------------------------------

export interface ApplyContext {
  workspaceId: string;
  actorId: string | null;
  /** Field definitions by item type id, covering every type in the batch. */
  fieldsByType: Map<string, Field[]>;
}

/**
 * Writes a batch of snapshots, then recomputes every derived column from the
 * result. Insert / update / soft-delete are decided by the pair
 * `(before === null, after === null)`, which is what lets undo be a plain swap
 * of the two rather than a separate inverse-operation implementation.
 */
export interface SnapshotChange {
  before: ItemSnapshot | null;
  after: ItemSnapshot | null;
  /** Set when undoing a create — the row should leave no trace. */
  hardDelete?: boolean;
}

export async function applySnapshots(
  tx: Tx,
  ctx: ApplyContext,
  changes: ReadonlyArray<SnapshotChange>,
): Promise<{ touchedIds: string[]; fullReprojectIds: string[] }> {
  const now = new Date();
  const touchedIds: string[] = [];
  /**
   * Items whose projection rows cannot be updated incrementally.
   *
   * Two cases, both of which the value-delta check in `syncProjection` would
   * silently skip because `effective_values` is unchanged:
   *
   *   - **A restore.** Deleting an item drops its index rows, so an undo has
   *     to rebuild them even though the values it restores are identical.
   *   - **A type change.** Index rows are keyed by `field_id`, so the rows for
   *     the *old* type's fields would otherwise linger forever and keep
   *     matching filters on a type the item no longer has.
   */
  const fullReprojectIds: string[] = [];

  const toInsert: ItemSnapshot[] = [];
  const toUpdate: ItemSnapshot[] = [];
  const toDelete: string[] = [];
  const toPurge: string[] = [];
  const toRestore: ItemSnapshot[] = [];

  for (const change of changes) {
    if (change.after === null) {
      if (change.before) {
        if (change.hardDelete) toPurge.push(change.before.id);
        else toDelete.push(change.before.id);
        touchedIds.push(change.before.id);
      }
      continue;
    }
    touchedIds.push(change.after.id);

    if (change.before === null) {
      toInsert.push(change.after);
      fullReprojectIds.push(change.after.id);
    } else if (change.before.deleted && !change.after.deleted) {
      toRestore.push(change.after);
      fullReprojectIds.push(change.after.id);
    } else {
      toUpdate.push(change.after);
      if (change.before.itemTypeId !== change.after.itemTypeId) {
        fullReprojectIds.push(change.after.id);
      }
    }
  }

  for (const snapshot of [...toInsert, ...toRestore]) {
    // Upsert rather than insert: undoing a delete targets a row that still
    // exists (soft-deleted), while undoing a create targets one that does not.
    await tx
      .insert(items)
      .values({
        id: snapshot.id,
        workspaceId: ctx.workspaceId,
        itemTypeId: snapshot.itemTypeId,
        title: snapshot.title,
        parentId: snapshot.parentId,
        path: snapshot.path,
        orderKey: snapshot.orderKey,
        isVariantModel: snapshot.isVariantModel,
        variantOfId: snapshot.variantOfId,
        variantAxisValues: snapshot.variantAxisValues,
        values: snapshot.values,
        invalidValues: snapshot.invalidValues,
        assigneeId: snapshot.assigneeId,
        createdBy: ctx.actorId,
        updatedBy: ctx.actorId,
        deletedAt: snapshot.deleted ? now : null,
      })
      .onConflictDoUpdate({
        target: items.id,
        set: {
          itemTypeId: snapshot.itemTypeId,
          title: snapshot.title,
          parentId: snapshot.parentId,
          path: sql`${snapshot.path}::ltree`,
          orderKey: snapshot.orderKey,
          isVariantModel: snapshot.isVariantModel,
          variantOfId: snapshot.variantOfId,
          variantAxisValues: snapshot.variantAxisValues,
          values: snapshot.values,
          invalidValues: snapshot.invalidValues,
          assigneeId: snapshot.assigneeId,
          updatedBy: ctx.actorId,
          updatedAt: now,
          deletedAt: snapshot.deleted ? now : null,
        },
      });
  }

  for (const snapshot of toUpdate) {
    await tx
      .update(items)
      .set({
        itemTypeId: snapshot.itemTypeId,
        title: snapshot.title,
        parentId: snapshot.parentId,
        path: sql`${snapshot.path}::ltree`,
        orderKey: snapshot.orderKey,
        isVariantModel: snapshot.isVariantModel,
        variantOfId: snapshot.variantOfId,
        variantAxisValues: snapshot.variantAxisValues,
        values: snapshot.values,
        invalidValues: snapshot.invalidValues,
        assigneeId: snapshot.assigneeId,
        updatedBy: ctx.actorId,
        updatedAt: now,
        deletedAt: snapshot.deleted ? now : null,
      })
      .where(and(eq(items.workspaceId, ctx.workspaceId), eq(items.id, snapshot.id)));
  }

  if (toDelete.length > 0) {
    // Soft delete: the row stays so undo is a restore rather than a
    // reconstruction, and so a relation pointing at it does not dangle.
    await tx
      .update(items)
      .set({ deletedAt: now, updatedBy: ctx.actorId, updatedAt: now })
      .where(and(eq(items.workspaceId, ctx.workspaceId), inArray(items.id, toDelete)));
    await tx.delete(itemFieldIndex).where(inArray(itemFieldIndex.itemId, toDelete));
  }

  if (toPurge.length > 0) {
    // Undoing a create. The row is removed outright; the change entries that
    // record it survive, because `change_entries.item_id` is deliberately not
    // a foreign key.
    await tx
      .delete(items)
      .where(and(eq(items.workspaceId, ctx.workspaceId), inArray(items.id, toPurge)));
  }

  await syncTreeMemberships(tx, ctx, changes);

  return { touchedIds, fullReprojectIds };
}

async function syncTreeMemberships(
  tx: Tx,
  ctx: ApplyContext,
  changes: ReadonlyArray<{ before: ItemSnapshot | null; after: ItemSnapshot | null }>,
): Promise<void> {
  const additions: Array<{ itemId: string; treeNodeId: string }> = [];
  const removals: Array<{ itemId: string; treeNodeId: string }> = [];

  for (const change of changes) {
    const beforeIds = new Set(change.before?.treeNodeIds ?? []);
    const afterIds = new Set(change.after?.treeNodeIds ?? []);
    const itemId = change.after?.id ?? change.before?.id;
    if (!itemId) continue;

    for (const id of afterIds) if (!beforeIds.has(id)) additions.push({ itemId, treeNodeId: id });
    for (const id of beforeIds) if (!afterIds.has(id)) removals.push({ itemId, treeNodeId: id });
  }

  if (removals.length > 0) {
    for (const removal of removals) {
      await tx
        .delete(itemTreeNodes)
        .where(
          and(
            eq(itemTreeNodes.workspaceId, ctx.workspaceId),
            eq(itemTreeNodes.itemId, removal.itemId),
            eq(itemTreeNodes.treeNodeId, removal.treeNodeId),
          ),
        );
    }
  }

  if (additions.length > 0) {
    const nodeIds = [...new Set(additions.map((a) => a.treeNodeId))];
    const nodes = await tx
      .select({ id: treeNodes.id, treeId: treeNodes.treeId })
      .from(treeNodes)
      .where(and(eq(treeNodes.workspaceId, ctx.workspaceId), inArray(treeNodes.id, nodeIds)));
    const treeIdByNode = new Map(nodes.map((n) => [n.id, n.treeId]));

    const rows = additions
      .filter((a) => treeIdByNode.has(a.treeNodeId))
      .map((a) => ({
        workspaceId: ctx.workspaceId,
        itemId: a.itemId,
        treeNodeId: a.treeNodeId,
        treeId: treeIdByNode.get(a.treeNodeId) as string,
        assignedBy: ctx.actorId,
      }));

    if (rows.length > 0) {
      await tx.insert(itemTreeNodes).values(rows).onConflictDoNothing();
    }
  }

  const affectedNodes = [
    ...new Set([...additions, ...removals].map((c) => c.treeNodeId)),
  ];
  if (affectedNodes.length > 0) {
    // Denormalised count, kept transactional with the membership change so the
    // sidebar never shows a number the grid disagrees with.
    await tx.execute(sql`
      update tree_nodes n
      set item_count = coalesce(c.n, 0)
      from (
        select tn.id, count(itn.item_id)::int as n
        from tree_nodes tn
        left join item_tree_nodes itn on itn.tree_node_id = tn.id
        left join items i on i.id = itn.item_id and i.deleted_at is null
        where tn.workspace_id = ${ctx.workspaceId}
          and tn.id in ${sql`(${sql.join(affectedNodes.map((id) => sql`${id}::uuid`), sql`, `)})`}
        group by tn.id
      ) c
      where n.id = c.id
    `);
  }
}

/**
 * Recomputes every derived column for the given items and, when a variant
 * model is among them, for its variants too.
 *
 * Ordering matters: models are recomputed first so variants resolve against
 * the model's *new* values rather than a half-applied mixture.
 */
export async function recomputeDerived(
  tx: Tx,
  ctx: ApplyContext,
  itemIds: readonly string[],
  fullReprojectIds: readonly string[] = [],
): Promise<{ recomputed: number; variantsTouched: string[] }> {
  if (itemIds.length === 0) return { recomputed: 0, variantsTouched: [] };
  const forceFull = new Set(fullReprojectIds);
  if (forceFull.size > 0) {
    // Clear first: a type change leaves rows keyed by the old type's field ids
    // that no incremental upsert would ever visit.
    await removeProjection(tx, [...forceFull]);
  }

  const loaded = await loadItems(tx, ctx.workspaceId, itemIds, { includeDeleted: true });
  const models = loaded.filter((i) => i.isVariantModel);
  const variantsOfTouchedModels = await loadVariantsOf(
    tx,
    ctx.workspaceId,
    models.map((m) => m.id),
  );

  const alreadyLoaded = new Set(loaded.map((i) => i.id));
  const extraVariants = variantsOfTouchedModels.filter((v) => !alreadyLoaded.has(v.id));

  // Models first, then everything else — a variant recomputed before its model
  // would inherit the pre-write value and need a second pass.
  const ordered = [...models, ...loaded.filter((i) => !i.isVariantModel), ...extraVariants];

  const modelIdsNeeded = [
    ...new Set(ordered.map((i) => i.variantOfId).filter((id): id is string => id !== null)),
  ];
  const modelRows = await loadItems(tx, ctx.workspaceId, modelIdsNeeded, { includeDeleted: true });
  const modelValues = new Map<string, ItemValues>([
    ...models.map((m) => [m.id, m.values] as const),
    ...modelRows.map((m) => [m.id, m.values] as const),
  ]);

  // Axis fields resolve to the variant's own value regardless of inheritance,
  // so resolution needs each type's declared axes alongside its fields.
  const typeIdsInBatch = [...new Set(ordered.map((i) => i.itemTypeId))];
  const axisRows = typeIdsInBatch.length
    ? await tx
        .select({ id: itemTypes.id, variantAxes: itemTypes.variantAxes })
        .from(itemTypes)
        .where(and(eq(itemTypes.workspaceId, ctx.workspaceId), inArray(itemTypes.id, typeIdsInBatch)))
    : [];
  const axesByType = new Map(axisRows.map((r) => [r.id, r.variantAxes]));

  const projectionTargets: Array<{
    itemId: string;
    itemTypeId: string;
    effectiveValues: ItemValues;
    previousEffectiveValues?: ItemValues;
  }> = [];

  for (const item of ordered) {
    const fields = ctx.fieldsByType.get(item.itemTypeId) ?? [];
    const derived = computeDerived(
      snapshotOf(item),
      fields,
      item.variantOfId ? (modelValues.get(item.variantOfId) ?? null) : null,
      axesByType.get(item.itemTypeId) ?? [],
    );

    await tx
      .update(items)
      .set({
        effectiveValues: derived.effectiveValues,
        completenessPct: derived.completenessPct,
        missingRequired: derived.missingRequired,
        searchText: derived.searchText,
      })
      .where(and(eq(items.workspaceId, ctx.workspaceId), eq(items.id, item.id)));

    if (item.deletedAt === null) {
      projectionTargets.push({
        itemId: item.id,
        itemTypeId: item.itemTypeId,
        effectiveValues: derived.effectiveValues,
        // `undefined` means "write every field", which is what a restored or
        // retyped item needs — its rows were just removed, so the delta
        // against its unchanged values would produce no writes at all.
        previousEffectiveValues: forceFull.has(item.id) ? undefined : item.effectiveValues,
      });
    }
  }

  const byType = new Map<string, IndexableField[]>();
  for (const [typeId, fields] of ctx.fieldsByType) byType.set(typeId, fields);

  for (const [typeId, fields] of byType) {
    const targets = projectionTargets.filter((t) => t.itemTypeId === typeId);
    if (targets.length > 0) {
      await syncProjection(tx, ctx.workspaceId, fields, targets);
    }
  }

  return {
    recomputed: ordered.length,
    variantsTouched: extraVariants.map((v) => v.id),
  };
}
