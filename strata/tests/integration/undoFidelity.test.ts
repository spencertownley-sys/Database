/**
 * Undo fidelity.
 *
 * For each of the nine user-initiated operations: snapshot the workspace,
 * apply the change, assert it actually changed something, undo it, and assert
 * the workspace is byte-identical to the snapshot — including
 * `effective_values`, `item_field_index`, `completeness_pct`, `path`, tree
 * memberships, and the denormalised node counts.
 *
 * The "assert it actually changed something" step matters as much as the
 * equality: an operation that silently no-ops would pass an undo test
 * trivially, and that failure mode is easy to introduce and hard to notice.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { appDb, asWorkspace, closeTestDb, ownerClient, workspaceIdBySlug, type AppTx } from './helpers/db';
import { snapshotWorkspace, type WorkspaceSnapshot } from './helpers/workspaceSnapshot';
import {
  commitChangeSet,
  previewChangeSet,
  undoChangeSet,
  type ChangeContext,
  type ChangeSetInput,
} from '@/server/services/changeSets.service';
import type { Actor } from '@/server/services/permissions.service';
import { items } from '@/server/db/schema/items';
import { itemTypes } from '@/server/db/schema/itemTypes';
import { treeNodes } from '@/server/db/schema/trees';

let workspaceId: string;
let actor: Actor;

beforeAll(async () => {
  workspaceId = await workspaceIdBySlug('northwind');

  const [member] = await ownerClient<Array<{ id: string; user_id: string }>>`
    select id, user_id from workspace_members
    where workspace_id = ${workspaceId} and role = 'owner' limit 1
  `;
  if (!member) throw new Error('Seed missing an owner member. Run `npm run db:seed`.');

  actor = {
    userId: member.user_id,
    workspaceId,
    memberId: member.id,
    role: 'owner',
  };
});

afterAll(async () => {
  await closeTestDb();
});

function ctx(): ChangeContext {
  return { workspaceId, actor, source: 'user' };
}

/** Snapshot → apply → assert changed → undo → assert identical. */
async function roundTrip(
  label: string,
  build: (tx: AppTx) => Promise<ChangeSetInput>,
): Promise<void> {
  const before: WorkspaceSnapshot = await asWorkspace(workspaceId, (tx) =>
    snapshotWorkspace(tx, workspaceId),
  );

  const changeSetId = await asWorkspace(workspaceId, async (tx) => {
    const input = await build(tx);
    const { changeSet } = await previewChangeSet(tx, ctx(), input);
    expect(changeSet.status, `${label}: preview should not commit`).toBe('preview');
    expect(changeSet.itemCount, `${label}: preview affected nothing`).toBeGreaterThan(0);

    // A preview must not have touched `items` yet.
    const midway = await snapshotWorkspace(tx, workspaceId);
    expect(midway.items, `${label}: preview wrote to items`).toBe(before.items);

    await commitChangeSet(tx, ctx(), changeSet.id);
    return changeSet.id;
  });

  // Compared across the whole snapshot, not just `items`: a tree assignment
  // touches only `item_tree_nodes`, and asserting on `items` alone would let a
  // silently no-op operation pass its own undo test.
  const afterCommit = await asWorkspace(workspaceId, (tx) => snapshotWorkspace(tx, workspaceId));
  expect(
    JSON.stringify(afterCommit),
    `${label}: commit changed nothing`,
  ).not.toBe(JSON.stringify(before));

  await asWorkspace(workspaceId, (tx) => undoChangeSet(tx, ctx(), changeSetId));

  const afterUndo = await asWorkspace(workspaceId, (tx) => snapshotWorkspace(tx, workspaceId));
  expect(afterUndo.items, `${label}: items not restored`).toBe(before.items);
  expect(afterUndo.projection, `${label}: item_field_index not restored`).toBe(before.projection);
  expect(afterUndo.memberships, `${label}: tree memberships not restored`).toBe(before.memberships);
  expect(afterUndo.treeCounts, `${label}: tree node counts not restored`).toBe(before.treeCounts);
}

async function taskTypeId(tx: AppTx): Promise<string> {
  const [row] = await tx
    .select({ id: itemTypes.id })
    .from(itemTypes)
    .where(and(eq(itemTypes.workspaceId, workspaceId), eq(itemTypes.key, 'task')))
    .limit(1);
  if (!row) throw new Error('Seed missing the task item type.');
  return row.id;
}

async function someTaskIds(tx: AppTx, limit: number): Promise<string[]> {
  const typeId = await taskTypeId(tx);
  const rows = await tx
    .select({ id: items.id })
    .from(items)
    .where(
      and(
        eq(items.workspaceId, workspaceId),
        eq(items.itemTypeId, typeId),
        isNull(items.archivedAt),
      ),
    )
    .orderBy(items.id)
    .limit(limit);
  return rows.map((r) => r.id);
}

describe('undo fidelity — all nine operations', () => {
  it('create', async () => {
    await roundTrip('create', async (tx) => ({
      operation: 'create',
      itemTypeId: await taskTypeId(tx),
      target: {
        kind: 'new',
        drafts: [
          { title: 'Undo fidelity probe A', values: { status: 'todo', priority: 'high' } },
          { title: 'Undo fidelity probe B', values: { status: 'in_progress' } },
        ],
      },
    }));
  });

  it('set_field', async () => {
    await roundTrip('set_field', async (tx) => ({
      operation: 'set_field',
      target: { kind: 'ids', itemIds: await someTaskIds(tx, 12) },
      patch: { values: { status: 'blocked', priority: 'urgent' } },
    }));
  });

  it('clear_field', async () => {
    await roundTrip('clear_field', async (tx) => {
      // Pick items that actually have the field set, or the operation no-ops
      // and the round trip proves nothing.
      const typeId = await taskTypeId(tx);
      const rows = await tx.execute(sql`
        select id from items
        where workspace_id = ${workspaceId}
          and item_type_id = ${typeId}::uuid
          and archived_at is null
          and values ? 'priority'
        order by id limit 8
      `);
      return {
        operation: 'clear_field',
        target: { kind: 'ids', itemIds: ([...rows] as Array<{ id: string }>).map((r) => r.id) },
        patch: { fieldKeys: ['priority'] },
      };
    });
  });

  it('change_type', async () => {
    await roundTrip('change_type', async (tx) => {
      const [campaign] = await tx
        .select({ id: itemTypes.id })
        .from(itemTypes)
        .where(and(eq(itemTypes.workspaceId, workspaceId), eq(itemTypes.key, 'campaign')))
        .limit(1);
      if (!campaign) throw new Error('Seed missing the campaign item type.');
      return {
        operation: 'change_type',
        target: { kind: 'ids', itemIds: await someTaskIds(tx, 3) },
        patch: { itemTypeId: campaign.id },
      };
    });
  });

  it('reparent — including every descendant path', async () => {
    await roundTrip('reparent', async (tx) => {
      // A task that has children, moved under a different project, so the
      // descendants' paths must be repointed and then put back.
      const rows = await tx.execute(sql`
        select p.id as parent_id, p.parent_id as grandparent_id
        from items p
        where p.workspace_id = ${workspaceId}
          and p.archived_at is null
          and exists (select 1 from items c where c.parent_id = p.id and c.archived_at is null)
        order by p.id
        limit 1
      `);
      const moving = ([...rows][0] ?? null) as { parent_id: string; grandparent_id: string } | null;
      if (!moving) throw new Error('Seed has no item with children.');

      const destinations = await tx.execute(sql`
        select id from items
        where workspace_id = ${workspaceId}
          and parent_id is null
          and archived_at is null
          and is_variant_model = false
          and id <> ${moving.grandparent_id ?? moving.parent_id}::uuid
        order by id limit 1
      `);
      const destination = ([...destinations][0] ?? null) as { id: string } | null;
      if (!destination) throw new Error('Seed has no alternative parent.');

      return {
        operation: 'reparent',
        target: { kind: 'ids', itemIds: [moving.parent_id] },
        patch: { itemId: moving.parent_id, parentId: destination.id },
      };
    });
  });

  it('tree_assign', async () => {
    await roundTrip('tree_assign', async (tx) => {
      const [node] = await tx
        .select({ id: treeNodes.id })
        .from(treeNodes)
        .where(eq(treeNodes.workspaceId, workspaceId))
        .orderBy(treeNodes.id)
        .limit(1);
      if (!node) throw new Error('Seed missing tree nodes.');
      return {
        operation: 'tree_assign',
        target: { kind: 'ids', itemIds: await someTaskIds(tx, 6) },
        patch: { treeNodeIds: [node.id] },
      };
    });
  });

  it('tree_unassign', async () => {
    await roundTrip('tree_unassign', async (tx) => {
      const rows = await tx.execute(sql`
        select item_id, tree_node_id from item_tree_nodes
        where workspace_id = ${workspaceId}
        order by item_id limit 5
      `);
      const memberships = [...rows] as Array<{ item_id: string; tree_node_id: string }>;
      if (memberships.length === 0) throw new Error('Seed has no tree memberships.');
      const nodeId = memberships[0]?.tree_node_id as string;
      return {
        operation: 'tree_unassign',
        target: {
          kind: 'ids',
          itemIds: memberships.filter((m) => m.tree_node_id === nodeId).map((m) => m.item_id),
        },
        patch: { treeNodeIds: [nodeId] },
      };
    });
  });

  it('assign_user', async () => {
    await roundTrip('assign_user', async (tx) => {
      const rows = await tx.execute(sql`
        select m.user_id from workspace_members m
        where m.workspace_id = ${workspaceId} and m.role = 'member' and m.user_id is not null
        limit 1
      `);
      const editor = ([...rows][0] ?? null) as { user_id: string } | null;
      if (!editor) throw new Error('Seed missing an editor member.');
      return {
        operation: 'assign_user',
        target: { kind: 'ids', itemIds: await someTaskIds(tx, 7) },
        patch: { assigneeId: editor.user_id },
      };
    });
  });

  it('delete — including the whole subtree', async () => {
    await roundTrip('delete', async (tx) => {
      const rows = await tx.execute(sql`
        select p.id from items p
        where p.workspace_id = ${workspaceId}
          and p.archived_at is null
          and exists (select 1 from items c where c.parent_id = p.id and c.archived_at is null)
        order by p.id limit 1
      `);
      const target = ([...rows][0] ?? null) as { id: string } | null;
      if (!target) throw new Error('Seed has no item with children.');
      return {
        operation: 'delete',
        target: { kind: 'ids', itemIds: [target.id] },
      };
    });
  });
});

describe('single-item writes take the same path', () => {
  it('auto-commits and undoes exactly like a bulk edit', async () => {
    const before = await asWorkspace(workspaceId, (tx) => snapshotWorkspace(tx, workspaceId));

    const changeSetId = await asWorkspace(workspaceId, async (tx) => {
      const [id] = await someTaskIds(tx, 1);
      const { changeSet } = await previewChangeSet(tx, ctx(), {
        operation: 'set_field',
        target: { kind: 'ids', itemIds: [id as string] },
        patch: { values: { status: 'done' } },
      });
      expect(changeSet.itemCount).toBe(1);
      await commitChangeSet(tx, ctx(), changeSet.id);
      return changeSet.id;
    });

    await asWorkspace(workspaceId, (tx) => undoChangeSet(tx, ctx(), changeSetId));

    const after = await asWorkspace(workspaceId, (tx) => snapshotWorkspace(tx, workspaceId));
    expect(after.items).toBe(before.items);
    expect(after.projection).toBe(before.projection);
  });
});

describe('stale previews', () => {
  it('fails the whole commit rather than clobbering a concurrent edit', async () => {
    const [targetId] = await asWorkspace(workspaceId, (tx) => someTaskIds(tx, 1));

    const changeSetId = await asWorkspace(workspaceId, async (tx) => {
      const { changeSet } = await previewChangeSet(tx, ctx(), {
        operation: 'set_field',
        target: { kind: 'ids', itemIds: [targetId as string] },
        patch: { values: { status: 'review' } },
      });
      return changeSet.id;
    });

    // Someone else edits the same item between preview and commit.
    await asWorkspace(workspaceId, async (tx) => {
      const { changeSet } = await previewChangeSet(tx, ctx(), {
        operation: 'set_field',
        target: { kind: 'ids', itemIds: [targetId as string] },
        patch: { values: { priority: 'low' } },
      });
      await commitChangeSet(tx, ctx(), changeSet.id);
    });

    await expect(
      asWorkspace(workspaceId, (tx) => commitChangeSet(tx, ctx(), changeSetId)),
    ).rejects.toMatchObject({ code: 'STALE_PREVIEW' });

    // And the concurrent edit survived — the stale commit did not partially apply.
    const [row] = await appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
      const result = await tx.execute(
        sql`select effective_values from items where id = ${targetId as string}::uuid`,
      );
      return [...result] as Array<{ effective_values: Record<string, unknown> }>;
    });
    expect(row?.effective_values.priority).toBe('low');
    expect(row?.effective_values.status).not.toBe('review');
  });
});
