import { relations, sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, workspaceIdColumn } from './_shared';
import { users, workspaces } from './workspaces';

export const notificationKindEnum = pgEnum('notification_kind', [
  'assigned',
  'invited',
  'import_completed',
  'export_ready',
  'bulk_completed',
  'variant_propagated',
  'webhook_disabled',
]);

/**
 * In-app notification. Email delivery is decided per-kind by the recipient's
 * digest preference; the row is written either way so the notification centre
 * and the email never disagree about what happened.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: notificationKindEnum('kind').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    /** Deep link into the app; relative, never an absolute external URL. */
    href: text('href'),
    /** Ids only — never item field values. Notifications are logged and mailed. */
    context: jsonb('context').$type<Record<string, string>>().notNull().default({}),
    readAt: timestamp('read_at', { withTimezone: true, mode: 'date' }),
    emailedAt: timestamp('emailed_at', { withTimezone: true, mode: 'date' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_unread_idx')
      .on(t.workspaceId, t.userId, t.createdAt)
      .where(sql`${t.readAt} is null`),
    index('notifications_user_idx').on(t.workspaceId, t.userId, t.createdAt),
  ],
);

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
  workspace: one(workspaces, {
    fields: [notifications.workspaceId],
    references: [workspaces.id],
  }),
}));

export type Notification = typeof notifications.$inferSelect;
export type NotificationKind = (typeof notificationKindEnum.enumValues)[number];
