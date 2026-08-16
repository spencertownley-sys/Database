/**
 * Category trees — structure, dispositions, and count integrity.
 *
 * The two invariants under test are the ones §6 calls out by name: items are
 * never silently orphaned (deleting a node with members without a disposition
 * is refused, and every disposition accounts for every member), and the
 * denormalised `item_count` plus the per-read descendant rollup always agree
 * with `item_tree_nodes`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { asWorkspace, closeTestDb, ownerClient, workspaceIdBySlug } from './helpers/db';
import {
  createNode,
  createTree,
  deleteNode,
  deleteTree,
  listNodes,
  listTrees,
  refreshNodeCounts,
  updateNode,
} from '@/server/services/trees.service';
import { itemTreeNodes } from '@/server/db/schema/trees';
import { items } from '@/server/db/schema/items';
import { AppError } from '@/server/lib/errors';

let workspaceId: string;
let treeId: string;
let itemA: string;
let itemB: string;

/** node ids for the fixture shape:  root ─ branch ─ leaf,  root ─ side */
let root: string;
let branch: string;
let leaf: string;
let side: string;

beforeAll(async () => {
  workspaceId = await workspaceIdBySlug('northwind');

  const seeded = await asWorkspace(workspaceId, (tx) =>
    tx
      .select({ id: items.id })
      .from(items)
      .where(eq(items.workspaceId, workspaceId))
      .limit(2),
  );
  if (seeded.length < 2) throw new Error('Seed missing items. Run `npm run db:seed`.');
  itemA = (seeded[0] as { id: string }).id;
  itemB = (seeded[1] as { id: string }).id;

  const tree = await asWorkspace(workspaceId, (tx) =>
    createTree(tx, workspaceId, { label: 'Test taxonomy', key: 'test-taxonomy' }),
  );
  treeId = tree.id;

  await asWorkspace(workspaceId, async (tx) => {
    root = (await createNode(tx, workspaceId, treeId, { label: 'Root' })).id;
    branch = (await createNode(tx, workspaceId, treeId, { label: 'Branch', parentId: root })).id;
    leaf = (await createNode(tx, workspaceId, treeId, { label: 'Leaf', parentId: branch })).id;
    side = (await createNode(tx, workspaceId, treeId, { label: 'Side', parentId: root })).id;
  });
});

afterAll(async () => {
  // Hard-delete the fixture tree: the (workspace_id, key) unique index would
  // otherwise collide with a soft-deleted leftover on the next run.
  if (treeId) {
    await ownerClient`delete from item_tree_nodes where tree_id = ${treeId}`;
    await ownerClient`delete from tree_nodes where tree_id = ${treeId}`;
    await ownerClient`delete from trees where id = ${treeId}`;
  }
  await closeTestDb();
});

async function assign(itemId: string, nodeId: string): Promise<void> {
  await asWorkspace(workspaceId, async (tx) => {
    await tx
      .insert(itemTreeNodes)
      .values({ workspaceId, itemId, treeNodeId: nodeId, treeId })
      .onConflictDoNothing();
    await refreshNodeCounts(tx, workspaceId, [nodeId]);
  });
}

async function memberNodeIds(itemId: string): Promise<string[]> {
  const rows = await asWorkspace(workspaceId, (tx) =>
    tx
      .select({ nodeId: itemTreeNodes.treeNodeId })
      .from(itemTreeNodes)
      .where(and(eq(itemTreeNodes.workspaceId, workspaceId), eq(itemTreeNodes.itemId, itemId))),
  );
  return rows.map((r) => r.nodeId);
}

async function nodesById(): Promise<Map<string, Awaited<ReturnType<typeof listNodes>>[number]>> {
  const rows = await asWorkspace(workspaceId, (tx) => listNodes(tx, workspaceId, treeId));
  return new Map(rows.map((n) => [n.id, n]));
}

describe('tree cap', () => {
  it('refuses a second custom tree with TREE_LIMIT_REACHED', async () => {
    await expect(
      asWorkspace(workspaceId, (tx) => createTree(tx, workspaceId, { label: 'One too many' })),
    ).rejects.toMatchObject({ code: 'TREE_LIMIT_REACHED' });
  });

  it('does not count the built-in tree against the cap', async () => {
    const all = await asWorkspace(workspaceId, (tx) => listTrees(tx, workspaceId));
    const builtIn = all.filter((t) => t.isBuiltIn);
    const custom = all.filter((t) => !t.isBuiltIn);
    expect(builtIn.length).toBeGreaterThan(0);
    expect(custom).toHaveLength(1);
  });
});

describe('structure', () => {
  it('paths are self-inclusive and nested under the parent', async () => {
    const nodes = await nodesById();
    const rootPath = nodes.get(root)!.path;
    const branchPath = nodes.get(branch)!.path;
    const leafPath = nodes.get(leaf)!.path;

    expect(branchPath.startsWith(`${rootPath}.`)).toBe(true);
    expect(leafPath.startsWith(`${branchPath}.`)).toBe(true);
    expect(nodes.get(branch)!.childCount).toBe(1);
    expect(nodes.get(root)!.childCount).toBe(2);
  });

  it('reparenting rewrites the whole subtree path in one pass', async () => {
    // Move Branch (with Leaf inside it) under Side, then put it back.
    await asWorkspace(workspaceId, (tx) =>
      updateNode(tx, workspaceId, branch, { parentId: side }),
    );

    let nodes = await nodesById();
    expect(nodes.get(branch)!.parentId).toBe(side);
    expect(nodes.get(branch)!.path.startsWith(`${nodes.get(side)!.path}.`)).toBe(true);
    // The descendant moved with it — this is the subtree rewrite under test.
    expect(nodes.get(leaf)!.path.startsWith(`${nodes.get(branch)!.path}.`)).toBe(true);

    await asWorkspace(workspaceId, (tx) =>
      updateNode(tx, workspaceId, branch, { parentId: root }),
    );
    nodes = await nodesById();
    expect(nodes.get(leaf)!.path.startsWith(`${nodes.get(root)!.path}.`)).toBe(true);
  });

  it('rejects a reparent into the node’s own subtree', async () => {
    await expect(
      asWorkspace(workspaceId, (tx) => updateNode(tx, workspaceId, root, { parentId: leaf })),
    ).rejects.toMatchObject({ code: 'HIERARCHY_CYCLE' });
  });

  it('reorders a node before a named sibling', async () => {
    // Root's children are [Branch, Side]; move Side before Branch.
    await asWorkspace(workspaceId, (tx) =>
      updateNode(tx, workspaceId, side, { beforeNodeId: branch }),
    );
    const nodes = await nodesById();
    expect(nodes.get(side)!.position < nodes.get(branch)!.position).toBe(true);
  });
});

describe('counts and rollups', () => {
  it('item_count is direct-only; descendant rollups aggregate the subtree', async () => {
    await assign(itemA, leaf);
    await assign(itemB, side);

    const nodes = await nodesById();
    expect(nodes.get(leaf)!.itemCount).toBe(1);
    expect(nodes.get(branch)!.itemCount).toBe(0);
    expect(nodes.get(branch)!.descendantItemCount).toBe(1);
    expect(nodes.get(root)!.itemCount).toBe(0);
    expect(nodes.get(root)!.descendantItemCount).toBe(2);
  });
});

describe('node deletion dispositions', () => {
  it('refuses to delete a node with members and no disposition', async () => {
    const failure = await asWorkspace(workspaceId, (tx) =>
      deleteNode(tx, workspaceId, leaf, null),
    ).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(AppError);
    expect(failure).toMatchObject({
      code: 'NODE_HAS_MEMBERS',
      details: { memberCount: 1 },
    });
  });

  it('move_to_parent re-points members and refreshes both counts', async () => {
    const result = await asWorkspace(workspaceId, (tx) =>
      deleteNode(tx, workspaceId, leaf, { onMembers: 'move_to_parent' }),
    );
    expect(result).toMatchObject({ movedMembers: 1, unassignedMembers: 0 });

    expect(await memberNodeIds(itemA)).toContain(branch);
    const nodes = await nodesById();
    expect(nodes.has(leaf)).toBe(false);
    expect(nodes.get(branch)!.itemCount).toBe(1);
  });

  it('move_to dedupes when the item is already in the target', async () => {
    // itemA is now in Branch; put it in Side too, then collapse Branch → Side.
    await assign(itemA, side);
    const result = await asWorkspace(workspaceId, (tx) =>
      deleteNode(tx, workspaceId, branch, { onMembers: 'move_to', targetNodeId: side }),
    );
    expect(result.movedMembers).toBe(1);

    const memberships = await memberNodeIds(itemA);
    expect(memberships.filter((id) => id === side)).toHaveLength(1);
    const nodes = await nodesById();
    expect(nodes.get(side)!.itemCount).toBe(2); // itemA + itemB, not 3
  });

  it('unassign drops the memberships and reports how many', async () => {
    const scratch = await asWorkspace(workspaceId, (tx) =>
      createNode(tx, workspaceId, treeId, { label: 'Scratch', parentId: root }),
    );
    await assign(itemA, scratch.id);

    const result = await asWorkspace(workspaceId, (tx) =>
      deleteNode(tx, workspaceId, scratch.id, { onMembers: 'unassign' }),
    );
    expect(result).toMatchObject({ movedMembers: 0, unassignedMembers: 1 });
    expect(await memberNodeIds(itemA)).not.toContain(scratch.id);
  });

  it('children of a deleted node move up instead of vanishing', async () => {
    const parent = await asWorkspace(workspaceId, (tx) =>
      createNode(tx, workspaceId, treeId, { label: 'Doomed', parentId: root }),
    );
    const child = await asWorkspace(workspaceId, (tx) =>
      createNode(tx, workspaceId, treeId, { label: 'Survivor', parentId: parent.id }),
    );

    await asWorkspace(workspaceId, (tx) => deleteNode(tx, workspaceId, parent.id, null));

    const nodes = await nodesById();
    expect(nodes.has(parent.id)).toBe(false);
    expect(nodes.get(child.id)!.parentId).toBe(root);
    expect(nodes.get(child.id)!.path.startsWith(`${nodes.get(root)!.path}.`)).toBe(true);
  });
});

describe('tree deletion', () => {
  it('refuses while any node still has members', async () => {
    await expect(
      asWorkspace(workspaceId, (tx) => deleteTree(tx, workspaceId, treeId)),
    ).rejects.toMatchObject({ code: 'NODE_HAS_MEMBERS' });
  });

  it('never deletes the built-in tree', async () => {
    const all = await asWorkspace(workspaceId, (tx) => listTrees(tx, workspaceId));
    const builtIn = all.find((t) => t.isBuiltIn);
    expect(builtIn).toBeDefined();
    await expect(
      asWorkspace(workspaceId, (tx) => deleteTree(tx, workspaceId, builtIn!.id)),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('deletes cleanly once members are gone, freeing the cap', async () => {
    await asWorkspace(workspaceId, async (tx) => {
      await tx
        .delete(itemTreeNodes)
        .where(and(eq(itemTreeNodes.workspaceId, workspaceId), eq(itemTreeNodes.treeId, treeId)));
      await deleteTree(tx, workspaceId, treeId);
    });

    const all = await asWorkspace(workspaceId, (tx) => listTrees(tx, workspaceId));
    expect(all.some((t) => t.id === treeId)).toBe(false);

    // The cap frees up: a new custom tree is allowed again.
    const replacement = await asWorkspace(workspaceId, (tx) =>
      createTree(tx, workspaceId, { label: 'Replacement', key: 'replacement-taxonomy' }),
    );
    await ownerClient`delete from tree_nodes where tree_id = ${replacement.id}`;
    await ownerClient`delete from trees where id = ${replacement.id}`;
  });
});
