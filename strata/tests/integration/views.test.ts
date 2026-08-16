/**
 * Saved views, sharing, and guest scoping (Step 12).
 *
 * Three boundaries under test: private views are invisible to everyone but
 * their owner (including via direct GET — 404, not 403), the share token is
 * minted on share and *destroyed* on revoke or delete so a dead link stays
 * dead, and a guest's item listing is scoped to their granted branch by the
 * query itself — fail-closed when no grants exist.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { asWorkspace, closeTestDb, ownerClient, withNoWorkspace, workspaceIdBySlug } from './helpers/db';
import {
  createView,
  deleteView,
  getView,
  listViews,
  resolveShareToken,
  updateView,
} from '@/server/services/views.service';
import { searchProvider } from '@/server/search/PostgresSearchProvider';
import { itemTypes } from '@/server/db/schema/itemTypes';
import { itemTreeNodes, treeNodes } from '@/server/db/schema/trees';

let workspaceId: string;
let taskTypeId: string;
let aliceId: string;
let bobId: string;

const createdViewIds: string[] = [];

beforeAll(async () => {
  workspaceId = await workspaceIdBySlug('northwind');

  const people = await ownerClient<Array<{ id: string; email: string }>>`
    select id, email from users where email in ('alice@northwind.test', 'bob@northwind.test')
  `;
  aliceId = people.find((p) => p.email.startsWith('alice'))?.id as string;
  bobId = people.find((p) => p.email.startsWith('bob'))?.id as string;
  if (!aliceId || !bobId) throw new Error('Seed missing alice/bob. Run `npm run db:seed`.');

  const [task] = await asWorkspace(workspaceId, (tx) =>
    tx
      .select({ id: itemTypes.id })
      .from(itemTypes)
      .where(and(eq(itemTypes.workspaceId, workspaceId), eq(itemTypes.key, 'task')))
      .limit(1),
  );
  taskTypeId = (task as { id: string }).id;
});

afterAll(async () => {
  if (createdViewIds.length > 0) {
    await ownerClient`delete from views where id = any(${createdViewIds})`;
  }
  await closeTestDb();
});

describe('visibility', () => {
  it('private views exist only for their owner', async () => {
    const view = await asWorkspace(workspaceId, (tx) =>
      createView(tx, workspaceId, aliceId, {
        itemTypeId: taskTypeId,
        name: 'Alice private lens',
        visibility: 'private',
      }),
    );
    createdViewIds.push(view.id);

    const forAlice = await asWorkspace(workspaceId, (tx) =>
      listViews(tx, workspaceId, aliceId, taskTypeId),
    );
    const forBob = await asWorkspace(workspaceId, (tx) =>
      listViews(tx, workspaceId, bobId, taskTypeId),
    );
    expect(forAlice.some((v) => v.id === view.id)).toBe(true);
    expect(forBob.some((v) => v.id === view.id)).toBe(false);

    // Direct fetch by id is a 404 for Bob — indistinguishable from absent.
    await expect(
      asWorkspace(workspaceId, (tx) => getView(tx, workspaceId, view.id, bobId)),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('workspace views are visible to every member', async () => {
    const view = await asWorkspace(workspaceId, (tx) =>
      createView(tx, workspaceId, aliceId, {
        itemTypeId: taskTypeId,
        name: 'Team lens',
        visibility: 'workspace',
        config: { incompleteOnly: true },
      }),
    );
    createdViewIds.push(view.id);

    const forBob = await asWorkspace(workspaceId, (tx) =>
      listViews(tx, workspaceId, bobId, taskTypeId),
    );
    expect(forBob.some((v) => v.id === view.id)).toBe(true);
  });
});

describe('share tokens', () => {
  it('mints on share, resolves anonymously, dies on revoke', async () => {
    const view = await asWorkspace(workspaceId, (tx) =>
      createView(tx, workspaceId, aliceId, {
        itemTypeId: taskTypeId,
        name: 'Shared lens',
        visibility: 'workspace',
      }),
    );
    createdViewIds.push(view.id);
    expect(view.shareToken).toBeNull();

    const shared = await asWorkspace(workspaceId, (tx) =>
      updateView(tx, workspaceId, aliceId, view.id, { visibility: 'shared' }),
    );
    expect(shared.shareToken).toBeTruthy();

    // Anonymous resolution: no workspace pinned, like the /share route.
    const resolved = await withNoWorkspace((tx) =>
      resolveShareToken(tx, shared.shareToken as string),
    );
    expect(resolved).toMatchObject({ viewId: view.id, workspaceId, itemTypeId: taskTypeId });

    // Revoking kills the link immediately and permanently.
    const revoked = await asWorkspace(workspaceId, (tx) =>
      updateView(tx, workspaceId, aliceId, view.id, { visibility: 'workspace' }),
    );
    expect(revoked.shareToken).toBeNull();
    expect(
      await withNoWorkspace((tx) => resolveShareToken(tx, shared.shareToken as string)),
    ).toBeNull();
  });

  it('deleting a shared view revokes its token', async () => {
    const view = await asWorkspace(workspaceId, (tx) =>
      createView(tx, workspaceId, aliceId, {
        itemTypeId: taskTypeId,
        name: 'Doomed shared lens',
        visibility: 'shared',
      }),
    );
    createdViewIds.push(view.id);
    const token = view.shareToken as string;
    expect(await withNoWorkspace((tx) => resolveShareToken(tx, token))).not.toBeNull();

    await asWorkspace(workspaceId, (tx) => deleteView(tx, workspaceId, aliceId, view.id));
    expect(await withNoWorkspace((tx) => resolveShareToken(tx, token))).toBeNull();
  });

  it('rejects malformed tokens without touching the database', async () => {
    expect(await withNoWorkspace((tx) => resolveShareToken(tx, 'no'))).toBeNull();
    expect(await withNoWorkspace((tx) => resolveShareToken(tx, 'x'.repeat(200)))).toBeNull();
  });
});

describe('guest scoping', () => {
  it('a guest list is confined to the granted branch, fail-closed', async () => {
    // The seed scopes dana@client.test to the first client's subtree.
    const [scope] = await ownerClient<
      Array<{ tree_node_id: string; include_descendants: boolean }>
    >`
      select gs.tree_node_id, gs.include_descendants
      from guest_scopes gs
      join workspace_members m on m.id = gs.member_id
      join users u on u.id = m.user_id
      where gs.workspace_id = ${workspaceId} and u.email = 'dana@client.test'
    `;
    if (!scope) throw new Error('Seed missing the guest scope.');

    const scopePath = await asWorkspace(workspaceId, async (tx) => {
      const [node] = await tx
        .select({ path: treeNodes.path })
        .from(treeNodes)
        .where(eq(treeNodes.id, scope.tree_node_id))
        .limit(1);
      return (node as { path: string }).path;
    });

    const { scoped, allowedIds } = await asWorkspace(workspaceId, async (tx) => {
      const page = await searchProvider.search(tx, workspaceId, [], {
        guestScopes: [{ treeNodePath: scopePath, includeDescendants: scope.include_descendants }],
        includeVariants: true,
        limit: 500,
      });

      // Ground truth: every item with a membership inside the branch.
      const memberships = await tx
        .select({ itemId: itemTreeNodes.itemId, path: treeNodes.path })
        .from(itemTreeNodes)
        .innerJoin(treeNodes, eq(treeNodes.id, itemTreeNodes.treeNodeId))
        .where(eq(itemTreeNodes.workspaceId, workspaceId));
      const inBranch = new Set(
        memberships
          .filter((m) => m.path === scopePath || m.path.startsWith(`${scopePath}.`))
          .map((m) => m.itemId),
      );
      return { scoped: page.items, allowedIds: inBranch };
    });

    expect(scoped.length).toBeGreaterThan(0);
    for (const item of scoped) {
      expect(allowedIds.has(item.id), `${item.title} leaked outside the granted branch`).toBe(true);
    }

    // No grants at all → no rows, never "all rows".
    const empty = await asWorkspace(workspaceId, (tx) =>
      searchProvider.search(tx, workspaceId, [], {
        guestScopes: [],
        includeVariants: true,
        limit: 10,
      }),
    );
    expect(empty.items).toHaveLength(0);
  });
});
