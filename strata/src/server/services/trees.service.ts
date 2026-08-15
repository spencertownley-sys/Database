/**
 * Category trees — the classification axis, independent of the work hierarchy.
 *
 * Two rules carry the whole feature:
 *
 *  1. **Never silently orphan items.** Deleting a node with members requires an
 *     explicit disposition — unassign, move to parent, or move to a chosen
 *     node (PRD §4.5, UI/UX §3.8). Without one the delete is refused with
 *     `NODE_HAS_MEMBERS` and the count, so the caller can ask properly.
 *
 *  2. **`item_count` is denormalised but never trusted.** It is recomputed
 *     transactionally from `item_tree_nodes` whenever membership or structure
 *     changes; descendant rollups are computed per read in one grouped query
 *     rather than stored, so a reparent never rewrites counts up two ancestor
 *     chains.
 *
 * Node deletion and reparenting are structural operations, not item mutations
 * — they do not go through change sets and are not undoable
 * (`CANNOT_UNDO_SCHEMA_CHANGE` is the honest answer). Item *membership*
 * changes always go through change sets (`tree_assign` / `tree_unassign`).
 */

import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '@/server/db';
import { itemTreeNodes, treeNodes, trees, type Tree, type TreeNode, MAX_USER_TREES } from '@/server/db/schema/trees';
import { AppError } from '@/server/lib/errors';
import { appendKeys, keyBetween } from '@/server/lib/fractionalIndex';
import { assertNoCycle, childPath } from '@/server/lib/ltree';
import { slugifyKey } from './itemTypes.service';

export type NodeDisposition =
  | { onMembers: 'unassign' }
  | { onMembers: 'move_to_parent' }
  | { onMembers: 'move_to'; targetNodeId: string };

export interface TreeWithCounts extends Tree {
  nodeCount: number;
}

export interface NodeWithCounts extends TreeNode {
  childCount: number;
  /** Direct members of this node's whole subtree, computed per read. */
  descendantItemCount: number;
}

export async function listTrees(tx: Tx, workspaceId: string): Promise<TreeWithCounts[]> {
  const rows = await tx.execute(sql`
    select t.*, coalesce(n.node_count, 0)::int as node_count
    from trees t
    left join (
      select tree_id, count(*)::int as node_count
      from tree_nodes where workspace_id = ${workspaceId}::uuid
      group by tree_id
    ) n on n.tree_id = t.id
    where t.workspace_id = ${workspaceId}::uuid and t.deleted_at is null
    order by t.is_built_in desc, t.position, t.created_at
  `);
  return [...rows].map((r) => shapeTree(r as Record<string, unknown>));
}

export async function createTree(
  tx: Tx,
  workspaceId: string,
  input: { label: string; key?: string; description?: string },
): Promise<Tree> {
  const existing = await tx
    .select({ id: trees.id, isBuiltIn: trees.isBuiltIn, key: trees.key })
    .from(trees)
    .where(and(eq(trees.workspaceId, workspaceId), isNull(trees.deletedAt)));

  const customCount = existing.filter((t) => !t.isBuiltIn).length;
  if (customCount >= MAX_USER_TREES) {
    throw new AppError(
      'TREE_LIMIT_REACHED',
      `This workspace already has ${MAX_USER_TREES} custom tree — the v1 limit. Rework the existing one, or file items into more of its nodes.`,
      { limit: MAX_USER_TREES },
    );
  }

  const taken = new Set(existing.map((t) => t.key));
  const key = input.key ?? slugifyKey(input.label, taken);
  if (taken.has(key)) {
    throw new AppError('CONFLICT', `A tree with the key "${key}" already exists.`);
  }

  const [created] = await tx
    .insert(trees)
    .values({
      workspaceId,
      key,
      label: input.label,
      description: input.description ?? null,
      isBuiltIn: false,
      position: existing.length,
    })
    .returning();
  if (!created) throw new AppError('INTERNAL_ERROR', 'The tree was not created.');
  return created;
}

export async function updateTree(
  tx: Tx,
  workspaceId: string,
  treeId: string,
  patch: { label?: string; description?: string },
): Promise<Tree> {
  const [updated] = await tx
    .update(trees)
    .set({
      ...(patch.label !== undefined ? { label: patch.label } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(trees.workspaceId, workspaceId), eq(trees.id, treeId), isNull(trees.deletedAt)))
    .returning();
  if (!updated) throw new AppError('NOT_FOUND', 'That tree no longer exists.');
  return updated;
}

export async function deleteTree(tx: Tx, workspaceId: string, treeId: string): Promise<void> {
  const [tree] = await tx
    .select()
    .from(trees)
    .where(and(eq(trees.workspaceId, workspaceId), eq(trees.id, treeId), isNull(trees.deletedAt)))
    .limit(1);
  if (!tree) throw new AppError('NOT_FOUND', 'That tree no longer exists.');
  if (tree.isBuiltIn) {
    throw new AppError('VALIDATION_ERROR', 'The built-in tree cannot be deleted.');
  }

  const [{ n } = { n: 0 }] = [
    ...(await tx.execute(sql`
      select count(*)::int as n from item_tree_nodes itn
      join tree_nodes tn on tn.id = itn.tree_node_id
      where tn.tree_id = ${treeId}::uuid and itn.workspace_id = ${workspaceId}::uuid
    `)),
  ] as Array<{ n: number }>;
  if (n > 0) {
    throw new AppError(
      'NODE_HAS_MEMBERS',
      `${n.toLocaleString()} item${n === 1 ? ' is' : 's are'} filed in this tree. Unassign them (or delete the nodes with a disposition) first.`,
      { memberCount: n },
    );
  }

  await tx.delete(treeNodes).where(and(eq(treeNodes.workspaceId, workspaceId), eq(treeNodes.treeId, treeId)));
  await tx
    .update(trees)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(trees.id, treeId));
}

/** Nodes of one tree with child counts and per-read descendant rollups. */
export async function listNodes(
  tx: Tx,
  workspaceId: string,
  treeId: string,
): Promise<NodeWithCounts[]> {
  // One grouped query for the rollup: every node's subtree member count comes
  // from a single self-join on path containment, not a query per node.
  const rows = await tx.execute(sql`
    select
      n.*,
      coalesce(c.child_count, 0)::int as child_count,
      coalesce(d.descendant_item_count, 0)::int as descendant_item_count
    from tree_nodes n
    left join (
      select parent_id, count(*)::int as child_count
      from tree_nodes where tree_id = ${treeId}::uuid
      group by parent_id
    ) c on c.parent_id = n.id
    left join (
      select anc.id, count(itn.item_id)::int as descendant_item_count
      from tree_nodes anc
      join tree_nodes descendant on descendant.path <@ anc.path and descendant.tree_id = anc.tree_id
      join item_tree_nodes itn on itn.tree_node_id = descendant.id
      where anc.tree_id = ${treeId}::uuid
      group by anc.id
    ) d on d.id = n.id
    where n.workspace_id = ${workspaceId}::uuid and n.tree_id = ${treeId}::uuid
    order by n.path, n.position
  `);
  return [...rows].map((r) => shapeNode(r as Record<string, unknown>));
}

export async function createNode(
  tx: Tx,
  workspaceId: string,
  treeId: string,
  input: { label: string; parentId?: string | null },
): Promise<TreeNode> {
  const [tree] = await tx
    .select({ id: trees.id })
    .from(trees)
    .where(and(eq(trees.workspaceId, workspaceId), eq(trees.id, treeId), isNull(trees.deletedAt)))
    .limit(1);
  if (!tree) throw new AppError('NOT_FOUND', 'That tree no longer exists.');

  let parentPath: string | null = null;
  if (input.parentId) {
    const [parent] = await tx
      .select({ path: treeNodes.path, treeId: treeNodes.treeId })
      .from(treeNodes)
      .where(and(eq(treeNodes.workspaceId, workspaceId), eq(treeNodes.id, input.parentId)))
      .limit(1);
    if (!parent || parent.treeId !== treeId) {
      throw new AppError('NOT_FOUND', 'The parent node no longer exists in this tree.');
    }
    parentPath = parent.path;
  }

  const [last] = await tx
    .select({ position: treeNodes.position })
    .from(treeNodes)
    .where(
      and(
        eq(treeNodes.treeId, treeId),
        input.parentId ? eq(treeNodes.parentId, input.parentId) : isNull(treeNodes.parentId),
      ),
    )
    .orderBy(sql`${treeNodes.position} desc`)
    .limit(1);

  const id = crypto.randomUUID();
  const [position] = appendKeys(last?.position ?? null, 1);
  const [created] = await tx
    .insert(treeNodes)
    .values({
      id,
      workspaceId,
      treeId,
      parentId: input.parentId ?? null,
      path: childPath(parentPath, id),
      position: position as string,
      label: input.label,
    })
    .returning();
  if (!created) throw new AppError('INTERNAL_ERROR', 'The node was not created.');
  return created;
}

export async function updateNode(
  tx: Tx,
  workspaceId: string,
  nodeId: string,
  patch: { label?: string; parentId?: string | null; beforeNodeId?: string | null },
): Promise<TreeNode> {
  const [node] = await tx
    .select()
    .from(treeNodes)
    .where(and(eq(treeNodes.workspaceId, workspaceId), eq(treeNodes.id, nodeId)))
    .limit(1);
  if (!node) throw new AppError('NOT_FOUND', 'That node no longer exists.');

  if (patch.label !== undefined) {
    await tx
      .update(treeNodes)
      .set({ label: patch.label, updatedAt: new Date() })
      .where(eq(treeNodes.id, nodeId));
  }

  if (patch.parentId !== undefined && patch.parentId !== node.parentId) {
    let newParentPath: string | null = null;
    if (patch.parentId !== null) {
      const [parent] = await tx
        .select({ path: treeNodes.path, treeId: treeNodes.treeId })
        .from(treeNodes)
        .where(and(eq(treeNodes.workspaceId, workspaceId), eq(treeNodes.id, patch.parentId)))
        .limit(1);
      if (!parent || parent.treeId !== node.treeId) {
        throw new AppError('NOT_FOUND', 'The destination node no longer exists in this tree.');
      }
      newParentPath = parent.path;
      assertNoCycle(node.path, newParentPath);
    }

    // One-statement subtree rewrite. The offset is `nlevel(old) - 1`, not
    // `nlevel(old)`: the moving node's own row keeps its final label, and
    // `subpath(p, nlevel(p))` would ask ltree for an empty slice and error.
    await tx.execute(sql`
      update tree_nodes
      set path = ${newParentPath ?? ''}::ltree || subpath(path, nlevel(${node.path}::ltree) - 1),
          updated_at = now()
      where workspace_id = ${workspaceId}::uuid
        and path <@ ${node.path}::ltree
    `);
    await tx
      .update(treeNodes)
      .set({ parentId: patch.parentId, updatedAt: new Date() })
      .where(eq(treeNodes.id, nodeId));
  }

  if (patch.beforeNodeId !== undefined) {
    await reorderNode(tx, workspaceId, nodeId, patch.beforeNodeId);
  }

  const [updated] = await tx
    .select()
    .from(treeNodes)
    .where(eq(treeNodes.id, nodeId))
    .limit(1);
  if (!updated) throw new AppError('INTERNAL_ERROR', 'The node vanished mid-update.');
  return updated;
}

/** Places a node immediately before a sibling (or last, when `null`). */
async function reorderNode(
  tx: Tx,
  workspaceId: string,
  nodeId: string,
  beforeNodeId: string | null,
): Promise<void> {
  const [node] = await tx
    .select({ treeId: treeNodes.treeId, parentId: treeNodes.parentId })
    .from(treeNodes)
    .where(and(eq(treeNodes.workspaceId, workspaceId), eq(treeNodes.id, nodeId)))
    .limit(1);
  if (!node) throw new AppError('NOT_FOUND', 'That node no longer exists.');

  const siblings = await tx
    .select({ id: treeNodes.id, position: treeNodes.position })
    .from(treeNodes)
    .where(
      and(
        eq(treeNodes.treeId, node.treeId),
        node.parentId ? eq(treeNodes.parentId, node.parentId) : isNull(treeNodes.parentId),
      ),
    )
    .orderBy(asc(treeNodes.position));

  const others = siblings.filter((s) => s.id !== nodeId);
  let position: string;
  if (beforeNodeId === null) {
    position = keyBetween(others[others.length - 1]?.position ?? null, null);
  } else {
    const idx = others.findIndex((s) => s.id === beforeNodeId);
    if (idx === -1) throw new AppError('NOT_FOUND', 'The reference node is not a sibling.');
    position = keyBetween(others[idx - 1]?.position ?? null, others[idx]?.position ?? null);
  }
  await tx.update(treeNodes).set({ position, updatedAt: new Date() }).where(eq(treeNodes.id, nodeId));
}

export async function deleteNode(
  tx: Tx,
  workspaceId: string,
  nodeId: string,
  disposition: NodeDisposition | null,
): Promise<{ movedMembers: number; unassignedMembers: number }> {
  const [node] = await tx
    .select()
    .from(treeNodes)
    .where(and(eq(treeNodes.workspaceId, workspaceId), eq(treeNodes.id, nodeId)))
    .limit(1);
  if (!node) throw new AppError('NOT_FOUND', 'That node no longer exists.');

  const members = await tx
    .select({ itemId: itemTreeNodes.itemId })
    .from(itemTreeNodes)
    .where(and(eq(itemTreeNodes.workspaceId, workspaceId), eq(itemTreeNodes.treeNodeId, nodeId)));

  if (members.length > 0 && disposition === null) {
    // Never silently orphan: the caller must choose what happens to members.
    throw new AppError(
      'NODE_HAS_MEMBERS',
      `${members.length.toLocaleString()} item${members.length === 1 ? ' is' : 's are'} in "${node.label}". Choose what happens to them: unassign, move to the parent, or move to another node.`,
      {
        memberCount: members.length,
        dispositions: ['unassign', 'move_to_parent', 'move_to'],
      },
    );
  }

  let moved = 0;
  let unassigned = 0;
  const touchedNodeIds = new Set<string>([nodeId]);

  if (members.length > 0 && disposition) {
    const targetNodeId =
      disposition.onMembers === 'move_to'
        ? disposition.targetNodeId
        : disposition.onMembers === 'move_to_parent'
          ? node.parentId
          : null;

    if (disposition.onMembers === 'move_to' || (disposition.onMembers === 'move_to_parent' && targetNodeId)) {
      if (!targetNodeId) throw new AppError('VALIDATION_ERROR', 'A destination node is required.');
      const [target] = await tx
        .select({ id: treeNodes.id, treeId: treeNodes.treeId })
        .from(treeNodes)
        .where(and(eq(treeNodes.workspaceId, workspaceId), eq(treeNodes.id, targetNodeId)))
        .limit(1);
      if (!target) throw new AppError('NOT_FOUND', 'The destination node no longer exists.');
      if (targetNodeId === nodeId) {
        throw new AppError('VALIDATION_ERROR', 'Items cannot move to the node being deleted.');
      }

      // Re-point memberships; an item already in the target just loses the
      // old row instead of gaining a duplicate.
      await tx.execute(sql`
        insert into item_tree_nodes (workspace_id, item_id, tree_node_id, tree_id)
        select workspace_id, item_id, ${targetNodeId}::uuid, ${target.treeId}::uuid
        from item_tree_nodes
        where workspace_id = ${workspaceId}::uuid and tree_node_id = ${nodeId}::uuid
        on conflict (item_id, tree_node_id) do nothing
      `);
      moved = members.length;
      touchedNodeIds.add(targetNodeId);
    } else {
      unassigned = members.length;
    }

    await tx
      .delete(itemTreeNodes)
      .where(and(eq(itemTreeNodes.workspaceId, workspaceId), eq(itemTreeNodes.treeNodeId, nodeId)));
  }

  // Child nodes move up one level rather than vanishing with their parent —
  // the RESTRICT FK forbids taking a subtree silently, and "my sub-categories
  // disappeared" is exactly the surprise it exists to prevent.
  const children = await tx
    .select({ id: treeNodes.id })
    .from(treeNodes)
    .where(and(eq(treeNodes.workspaceId, workspaceId), eq(treeNodes.parentId, nodeId)));
  for (const child of children) {
    await updateNode(tx, workspaceId, child.id, { parentId: node.parentId });
  }

  await tx.delete(treeNodes).where(eq(treeNodes.id, nodeId));
  await refreshNodeCounts(tx, workspaceId, [...touchedNodeIds]);

  return { movedMembers: moved, unassignedMembers: unassigned };
}

export async function refreshNodeCounts(
  tx: Tx,
  workspaceId: string,
  nodeIds: readonly string[],
): Promise<void> {
  if (nodeIds.length === 0) return;
  await tx.execute(sql`
    update tree_nodes n
    set item_count = coalesce(c.n, 0)
    from (
      select tn.id, count(itn.item_id)::int as n
      from tree_nodes tn
      left join item_tree_nodes itn on itn.tree_node_id = tn.id
      where tn.workspace_id = ${workspaceId}::uuid
        and tn.id in ${sql`(${sql.join(nodeIds.map((id) => sql`${id}::uuid`), sql`, `)})`}
      group by tn.id
    ) c
    where n.id = c.id and n.workspace_id = ${workspaceId}::uuid
  `);
}

function shapeTree(r: Record<string, unknown>): TreeWithCounts {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    key: r.key as string,
    label: r.label as string,
    description: (r.description as string) ?? null,
    icon: (r.icon as string) ?? null,
    isBuiltIn: r.is_built_in as boolean,
    position: Number(r.position),
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
    deletedAt: r.deleted_at ? new Date(r.deleted_at as string) : null,
    nodeCount: Number(r.node_count ?? 0),
  };
}

function shapeNode(r: Record<string, unknown>): NodeWithCounts {
  return {
    id: r.id as string,
    workspaceId: r.workspace_id as string,
    treeId: r.tree_id as string,
    parentId: (r.parent_id as string) ?? null,
    path: r.path as string,
    position: r.position as string,
    label: r.label as string,
    description: (r.description as string) ?? null,
    color: (r.color as string) ?? null,
    itemCount: Number(r.item_count ?? 0),
    createdAt: new Date(r.created_at as string),
    updatedAt: new Date(r.updated_at as string),
    childCount: Number(r.child_count ?? 0),
    descendantItemCount: Number(r.descendant_item_count ?? 0),
  };
}
