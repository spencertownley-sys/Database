/**
 * Webhooks — subscribe, sign, deliver, and know when to stop.
 *
 * Delivery here is synchronous best-effort: one attempt per event, made
 * *after* the triggering transaction commits (an HTTP call inside a database
 * transaction would hold locks for up to the 10s timeout). The Tech Spec's
 * retry ladder (1m/5m/30m/2h/12h) needs a job runner this build does not
 * have; failures are recorded with `next_attempt_at` so the schedule is ready
 * for one, and 20 consecutive failures auto-disables the endpoint — a dead
 * URL must not turn every workspace write into a doomed HTTP call.
 *
 * Signature (API Design §12): `X-Strata-Signature: v1,t=<unix>,s=<hex>`,
 * HMAC-SHA256 of `{t}.{raw_body}` with the endpoint secret. Bulk change sets
 * emit ONE `change_set.committed`, never N `item.updated`.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Tx } from '@/server/db';
import { withWorkspace } from '@/server/db';
import {
  MAX_WEBHOOK_FAILURES,
  WEBHOOK_EVENTS,
  webhookDeliveries,
  webhooks,
  type Webhook,
  type WebhookEvent,
} from '@/server/db/schema/webhooks';
import { workspaceMembers } from '@/server/db/schema/workspaces';
import { AppError } from '@/server/lib/errors';
import { createNotification } from './notifications.service';

const DELIVERY_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listWebhooks(tx: Tx, workspaceId: string): Promise<Webhook[]> {
  return tx
    .select()
    .from(webhooks)
    .where(eq(webhooks.workspaceId, workspaceId))
    .orderBy(desc(webhooks.createdAt));
}

export async function createWebhook(
  tx: Tx,
  workspaceId: string,
  userId: string | null,
  input: { url: string; events: string[]; description?: string },
): Promise<{ webhook: Webhook; secret: string }> {
  assertValidTarget(input.url);
  assertKnownEvents(input.events);

  const secret = `whsec_${randomBytes(24).toString('base64url')}`;
  const [created] = await tx
    .insert(webhooks)
    .values({
      workspaceId,
      url: input.url,
      events: input.events,
      secret,
      description: input.description ?? null,
      createdBy: userId,
    })
    .returning();
  if (!created) throw new AppError('INTERNAL_ERROR', 'The webhook was not created.');
  return { webhook: created, secret };
}

export async function updateWebhook(
  tx: Tx,
  workspaceId: string,
  webhookId: string,
  patch: { url?: string; events?: string[]; description?: string; active?: boolean },
): Promise<Webhook> {
  if (patch.url) assertValidTarget(patch.url);
  if (patch.events) assertKnownEvents(patch.events);

  const [updated] = await tx
    .update(webhooks)
    .set({
      ...(patch.url !== undefined ? { url: patch.url } : {}),
      ...(patch.events !== undefined ? { events: patch.events } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.active !== undefined
        ? // Re-enabling resets the failure count — the operator says it's fixed.
          { active: patch.active, consecutiveFailures: 0, disabledReason: null }
        : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.id, webhookId)))
    .returning();
  if (!updated) throw new AppError('NOT_FOUND', 'That webhook no longer exists.');
  return updated;
}

export async function deleteWebhook(tx: Tx, workspaceId: string, webhookId: string): Promise<void> {
  const deleted = await tx
    .delete(webhooks)
    .where(and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.id, webhookId)))
    .returning({ id: webhooks.id });
  if (deleted.length === 0) throw new AppError('NOT_FOUND', 'That webhook no longer exists.');
}

export async function listDeliveries(tx: Tx, workspaceId: string, webhookId: string) {
  return tx
    .select({
      id: webhookDeliveries.id,
      event: webhookDeliveries.event,
      status: webhookDeliveries.status,
      attempts: webhookDeliveries.attempts,
      responseStatus: webhookDeliveries.responseStatus,
      error: webhookDeliveries.error,
      createdAt: webhookDeliveries.createdAt,
      deliveredAt: webhookDeliveries.deliveredAt,
    })
    .from(webhookDeliveries)
    .where(
      and(eq(webhookDeliveries.workspaceId, workspaceId), eq(webhookDeliveries.webhookId, webhookId)),
    )
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(50);
}

function assertKnownEvents(events: readonly string[]): void {
  if (events.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Subscribe to at least one event.');
  }
  const known = new Set<string>(WEBHOOK_EVENTS);
  const bad = events.filter((e) => !known.has(e));
  if (bad.length > 0) {
    throw new AppError('VALIDATION_ERROR', `Unknown event${bad.length === 1 ? '' : 's'}: ${bad.join(', ')}.`, {
      knownEvents: WEBHOOK_EVENTS,
    });
  }
}

/** https only, and never a private/loopback literal — basic SSRF hygiene. */
function assertValidTarget(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new AppError('VALIDATION_ERROR', 'The webhook URL is not a valid URL.');
  }
  const devBypass = process.env.NODE_ENV !== 'production' || process.env.STRATA_ALLOW_HTTP_WEBHOOKS === '1';
  if (parsed.protocol !== 'https:' && !devBypass) {
    throw new AppError('VALIDATION_ERROR', 'Webhook URLs must be https.');
  }
  const host = parsed.hostname;
  if (
    !devBypass &&
    (host === 'localhost' ||
      /^127\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === '169.254.169.254')
  ) {
    throw new AppError('VALIDATION_ERROR', 'Webhook URLs must point at a public host.');
  }
}

// ---------------------------------------------------------------------------
// signing
// ---------------------------------------------------------------------------

export function signPayload(secret: string, body: string, timestamp: number): string {
  const s = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `v1,t=${timestamp},s=${s}`;
}

// ---------------------------------------------------------------------------
// emit + deliver
// ---------------------------------------------------------------------------

export interface WebhookEventInput {
  event: WebhookEvent;
  data: Record<string, unknown>;
}

/**
 * Fires `events` at every subscribed active endpoint. Call *after* the
 * triggering transaction has committed — this function opens its own short
 * transactions around the HTTP calls, never the other way round.
 */
export async function emitWebhookEvents(
  workspaceId: string,
  events: readonly WebhookEventInput[],
): Promise<void> {
  if (events.length === 0) return;

  const hooks = await withWorkspace(workspaceId, (tx) =>
    tx
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.active, true))),
  );
  if (hooks.length === 0) return;

  for (const hook of hooks) {
    const subscribed = new Set(hook.events);
    for (const { event, data } of events) {
      if (!subscribed.has(event)) continue;
      await deliverOne(workspaceId, hook, event, data);
    }
  }
}

async function deliverOne(
  workspaceId: string,
  hook: Webhook,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  const payload = {
    id: `evt_${crypto.randomUUID().replace(/-/g, '')}`,
    event,
    workspace_id: workspaceId,
    timestamp: new Date().toISOString(),
    data,
  };
  const body = JSON.stringify(payload);
  const timestamp = Math.floor(Date.now() / 1000);

  const [delivery] = await withWorkspace(workspaceId, (tx) =>
    tx
      .insert(webhookDeliveries)
      .values({
        workspaceId,
        webhookId: hook.id,
        event,
        payload,
        status: 'delivering',
        attempts: 1,
      })
      .returning({ id: webhookDeliveries.id }),
  );
  if (!delivery) return;

  let responseStatus: number | null = null;
  let error: string | null = null;
  try {
    const response = await fetch(hook.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-strata-signature': signPayload(hook.secret, body, timestamp),
        'x-strata-event': event,
      },
      body,
      signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
    });
    responseStatus = response.status;
    if (!response.ok) error = `Endpoint answered ${response.status}.`;
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 200) : 'Request failed.';
  }

  const succeeded = error === null;
  await withWorkspace(workspaceId, async (tx) => {
    await tx
      .update(webhookDeliveries)
      .set({
        status: succeeded ? 'succeeded' : 'failed',
        responseStatus,
        error,
        deliveredAt: succeeded ? new Date() : null,
        // The spec's ladder, position 1 — a future runner picks it up here.
        nextAttemptAt: succeeded ? null : new Date(Date.now() + 60_000),
        updatedAt: new Date(),
      })
      .where(eq(webhookDeliveries.id, delivery.id));

    if (succeeded) {
      await tx
        .update(webhooks)
        .set({ consecutiveFailures: 0, lastDeliveryAt: new Date(), updatedAt: new Date() })
        .where(eq(webhooks.id, hook.id));
      return;
    }

    const [updated] = await tx
      .update(webhooks)
      .set({
        consecutiveFailures: sql`${webhooks.consecutiveFailures} + 1`,
        lastDeliveryAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(webhooks.id, hook.id))
      .returning({ consecutiveFailures: webhooks.consecutiveFailures });

    if ((updated?.consecutiveFailures ?? 0) >= MAX_WEBHOOK_FAILURES) {
      await tx
        .update(webhooks)
        .set({
          active: false,
          disabledReason: `Disabled after ${MAX_WEBHOOK_FAILURES} consecutive failures.`,
          updatedAt: new Date(),
        })
        .where(eq(webhooks.id, hook.id));

      // Admins find out in-app; a silently dead integration is the worst kind.
      const admins = await tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, workspaceId),
            sql`${workspaceMembers.role} in ('owner', 'admin')`,
            eq(workspaceMembers.status, 'active'),
          ),
        );
      for (const admin of admins) {
        if (!admin.userId) continue;
        await createNotification(tx, workspaceId, {
          userId: admin.userId,
          kind: 'webhook_disabled',
          title: 'A webhook was disabled',
          body: `${hook.url} failed ${MAX_WEBHOOK_FAILURES} times in a row and has been turned off.`,
          href: '/settings/webhooks',
          context: { webhookId: hook.id },
        });
      }
    }
  });
}

/** `POST /webhooks/:id/test` — a synthetic event, same signing, same path. */
export async function sendTestEvent(workspaceId: string, webhookId: string): Promise<void> {
  const [hook] = await withWorkspace(workspaceId, (tx) =>
    tx
      .select()
      .from(webhooks)
      .where(and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.id, webhookId)))
      .limit(1),
  );
  if (!hook) throw new AppError('NOT_FOUND', 'That webhook no longer exists.');
  await deliverOne(workspaceId, hook, hook.events[0] as WebhookEvent, {
    test: true,
    message: 'This is a Strata test delivery.',
  });
}
