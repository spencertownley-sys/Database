/**
 * Webhooks + notifications (Step 13).
 *
 * The webhook tests run against a real local HTTP server so the signature
 * check is the real §12 recipe (HMAC-SHA256 over `{t}.{raw_body}`, constant
 * time) and not a mock's opinion. The failure path drives an endpoint to the
 * 20-failure auto-disable and asserts admins were told in-app.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, like, sql } from 'drizzle-orm';
import { asWorkspace, closeTestDb, ownerClient, workspaceIdBySlug } from './helpers/db';
import {
  createWebhook,
  emitWebhookEvents,
  listDeliveries,
  signPayload,
} from '@/server/services/webhooks.service';
import {
  createNotification,
  listNotifications,
  markNotificationsRead,
} from '@/server/services/notifications.service';
import {
  commitChangeSet,
  previewChangeSet,
  type ChangeContext,
} from '@/server/services/changeSets.service';
import type { Actor } from '@/server/services/permissions.service';
import { items } from '@/server/db/schema/items';

let workspaceId: string;
let actor: Actor;
let aliceId: string;
let bobId: string;

interface CapturedRequest {
  body: string;
  signature: string;
  event: string;
}

let server: Server;
let serverPort: number;
const captured: CapturedRequest[] = [];

beforeAll(async () => {
  workspaceId = await workspaceIdBySlug('northwind');
  const people = await ownerClient<Array<{ id: string; user_id: string; email: string; role: string }>>`
    select m.id, m.user_id, u.email, m.role from workspace_members m
    join users u on u.id = m.user_id
    where m.workspace_id = ${workspaceId} and u.email in ('alice@northwind.test', 'bob@northwind.test')
  `;
  const alice = people.find((p) => p.email.startsWith('alice'));
  const bob = people.find((p) => p.email.startsWith('bob'));
  if (!alice || !bob) throw new Error('Seed missing alice/bob.');
  aliceId = alice.user_id;
  bobId = bob.user_id;
  actor = { userId: alice.user_id, workspaceId, memberId: alice.id, role: 'owner' };

  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      captured.push({
        body,
        signature: String(req.headers['x-strata-signature'] ?? ''),
        event: String(req.headers['x-strata-event'] ?? ''),
      });
      res.writeHead(200).end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  serverPort = typeof address === 'object' && address ? address.port : 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await ownerClient`delete from webhook_deliveries where workspace_id = ${workspaceId}`;
  await ownerClient`delete from webhooks where workspace_id = ${workspaceId}`;
  await ownerClient`delete from notifications where workspace_id = ${workspaceId}`;
  await ownerClient`delete from items where workspace_id = ${workspaceId} and title like 'WebhookNotif %'`;
  await closeTestDb();
});

function ctx(): ChangeContext {
  return { workspaceId, actor, source: 'user' };
}

describe('webhook delivery', () => {
  it('delivers a signed payload the §12 recipe verifies', async () => {
    const { webhook, secret } = await asWorkspace(workspaceId, (tx) =>
      createWebhook(tx, workspaceId, aliceId, {
        url: `http://127.0.0.1:${serverPort}/hook`,
        events: ['change_set.committed'],
      }),
    );
    expect(secret.startsWith('whsec_')).toBe(true);

    await emitWebhookEvents(workspaceId, [
      { event: 'change_set.committed', data: { change_set_id: 'cs-test', item_count: 3 } },
    ]);

    expect(captured).toHaveLength(1);
    const hit = captured[0] as CapturedRequest;
    expect(hit.event).toBe('change_set.committed');

    // Verify exactly as the docs tell an integrator to.
    const match = /^v1,t=(\d+),s=([0-9a-f]+)$/.exec(hit.signature);
    expect(match, `unparseable signature: ${hit.signature}`).toBeTruthy();
    const [, t, s] = match as RegExpExecArray;
    const expected = createHmac('sha256', secret).update(`${t}.${hit.body}`).digest('hex');
    expect(timingSafeEqual(Buffer.from(expected), Buffer.from(s as string))).toBe(true);

    const payload = JSON.parse(hit.body) as { event: string; workspace_id: string; data: { item_count: number } };
    expect(payload.workspace_id).toBe(workspaceId);
    expect(payload.data.item_count).toBe(3);

    const deliveries = await asWorkspace(workspaceId, (tx) =>
      listDeliveries(tx, workspaceId, webhook.id),
    );
    expect(deliveries[0]).toMatchObject({ status: 'succeeded', responseStatus: 200 });

    // An event the hook is not subscribed to must not reach it.
    await emitWebhookEvents(workspaceId, [{ event: 'item.deleted', data: {} }]);
    expect(captured).toHaveLength(1);
  });

  it('signPayload round-trips independently of delivery', () => {
    const header = signPayload('whsec_fixed', '{"a":1}', 1_755_267_072);
    expect(header).toMatch(/^v1,t=1755267072,s=[0-9a-f]{64}$/);
  });

  it('auto-disables after 20 consecutive failures and tells the admins', async () => {
    const { webhook } = await asWorkspaceCreateDeadHook();
    // Fast-forward to the brink.
    await ownerClient`update webhooks set consecutive_failures = 19 where id = ${webhook.id}`;

    await emitWebhookEvents(workspaceId, [{ event: 'change_set.committed', data: {} }]);

    const [after] = await ownerClient<Array<{ active: boolean; disabled_reason: string | null }>>`
      select active, disabled_reason from webhooks where id = ${webhook.id}
    `;
    expect(after?.active).toBe(false);
    expect(after?.disabled_reason).toContain('20');

    const inbox = await asWorkspace(workspaceId, (tx) =>
      listNotifications(tx, workspaceId, aliceId, { kind: 'webhook_disabled' }),
    );
    expect(inbox.rows.length).toBeGreaterThan(0);
  });

  async function asWorkspaceCreateDeadHook() {
    return asWorkspace(workspaceId, (tx) =>
      createWebhook(tx, workspaceId, aliceId, {
        // A port nothing listens on — fails fast with a connection error.
        url: 'http://127.0.0.1:9/dead',
        events: ['change_set.committed'],
      }),
    );
  }
});

describe('notifications', () => {
  it('assignment through a change set notifies the assignee, not the actor', async () => {
    // Create an item, then assign Bob (actor is Alice).
    const itemId = await asWorkspace(workspaceId, async (tx) => {
      const taskType = await tx.execute(
        sql`select id from item_types where workspace_id = ${workspaceId}::uuid and key = 'task' limit 1`,
      );
      const typeId = ([...taskType][0] as { id: string }).id;
      const { changeSet } = await previewChangeSet(tx, ctx(), {
        operation: 'create',
        itemTypeId: typeId,
        target: { kind: 'new', drafts: [{ title: 'WebhookNotif assign target' }] },
      });
      await commitChangeSet(tx, ctx(), changeSet.id);
      const [row] = await tx
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.workspaceId, workspaceId), like(items.title, 'WebhookNotif %')))
        .limit(1);
      return (row as { id: string }).id;
    });

    await asWorkspace(workspaceId, async (tx) => {
      const { changeSet } = await previewChangeSet(tx, ctx(), {
        operation: 'assign_user',
        target: { kind: 'ids', itemIds: [itemId] },
        patch: { assigneeId: bobId },
      });
      await commitChangeSet(tx, ctx(), changeSet.id);
    });

    const bobInbox = await asWorkspace(workspaceId, (tx) =>
      listNotifications(tx, workspaceId, bobId, { unreadOnly: true }),
    );
    const assigned = bobInbox.rows.find((n) => n.kind === 'assigned');
    expect(assigned).toBeDefined();
    expect(assigned?.title).toContain('WebhookNotif assign target');
    // Context carries ids only — never field values.
    expect(assigned?.context).toMatchObject({ itemId });

    const aliceInbox = await asWorkspace(workspaceId, (tx) =>
      listNotifications(tx, workspaceId, aliceId, { kind: 'assigned' }),
    );
    expect(aliceInbox.rows.some((n) => n.context.itemId === itemId)).toBe(false);
  });

  it('mark-read: ids, then all, and the unread count follows', async () => {
    await asWorkspace(workspaceId, async (tx) => {
      await createNotification(tx, workspaceId, {
        userId: aliceId,
        kind: 'export_ready',
        title: 'WebhookNotif test one',
      });
      await createNotification(tx, workspaceId, {
        userId: aliceId,
        kind: 'export_ready',
        title: 'WebhookNotif test two',
      });
    });

    const before = await asWorkspace(workspaceId, (tx) =>
      listNotifications(tx, workspaceId, aliceId, { unreadOnly: true }),
    );
    expect(before.unreadCount).toBeGreaterThanOrEqual(2);

    const one = before.rows.find((n) => n.title === 'WebhookNotif test one');
    const marked = await asWorkspace(workspaceId, (tx) =>
      markNotificationsRead(tx, workspaceId, aliceId, { ids: [one?.id as string] }),
    );
    expect(marked).toBe(1);

    await asWorkspace(workspaceId, (tx) =>
      markNotificationsRead(tx, workspaceId, aliceId, { all: true }),
    );
    const after = await asWorkspace(workspaceId, (tx) =>
      listNotifications(tx, workspaceId, aliceId, { unreadOnly: true }),
    );
    expect(after.unreadCount).toBe(0);
  });
});
