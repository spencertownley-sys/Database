import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps, workspaceIdColumn } from './_shared';
import { users, workspaces } from './workspaces';

export const WEBHOOK_EVENTS = [
  'item.created',
  'item.updated',
  'item.deleted',
  'item.type_changed',
  'item.assigned',
  'change_set.committed',
  'change_set.undone',
  'import.completed',
  'export.ready',
  'variant.propagated',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const deliveryStatusEnum = pgEnum('webhook_delivery_status', [
  'pending',
  'delivering',
  'succeeded',
  'failed',
  'exhausted',
]);

export const webhooks = pgTable(
  'webhooks',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    events: text('events').array().notNull().default(sql`'{}'::text[]`),
    /** HMAC-SHA256 key. Shown once; rotating it invalidates in-flight retries. */
    secret: text('secret').notNull(),
    description: text('description'),
    active: boolean('active').notNull().default(true),
    /**
     * Auto-disabled at 20. A dead endpoint that keeps being retried forever
     * turns every workspace write into a queue of doomed HTTP calls.
     */
    consecutiveFailures: integer('consecutive_failures').notNull().default(0),
    disabledReason: text('disabled_reason'),
    lastDeliveryAt: timestamp('last_delivery_at', { withTimezone: true, mode: 'date' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [index('webhooks_ws_active_idx').on(t.workspaceId).where(sql`${t.active} = true`)],
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    webhookId: uuid('webhook_id')
      .notNull()
      .references(() => webhooks.id, { onDelete: 'cascade' }),
    event: text('event').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: deliveryStatusEnum('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    responseStatus: integer('response_status'),
    /** Truncated. Never store a response body that could echo item content. */
    responseSnippet: text('response_snippet'),
    error: text('error'),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true, mode: 'date' }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true, mode: 'date' }),
    ...timestamps(),
  },
  (t) => [
    index('webhook_deliveries_hook_idx').on(t.webhookId, t.createdAt),
    index('webhook_deliveries_pending_idx')
      .on(t.nextAttemptAt)
      .where(sql`${t.status} in ('pending', 'failed')`),
  ],
);

export const MAX_WEBHOOK_FAILURES = 20;

export const webhooksRelations = relations(webhooks, ({ many }) => ({
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  webhook: one(webhooks, { fields: [webhookDeliveries.webhookId], references: [webhooks.id] }),
}));

export type Webhook = typeof webhooks.$inferSelect;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
