/**
 * In-app notifications. Rows carry ids and titles, never item field values —
 * notifications end up in logs and (eventually) email, neither of which
 * should hold tenant data (CLAUDE.md: never log item content).
 *
 * Email delivery needs Resend, which this environment does not carry;
 * `emailedAt` stays null and the centre is the single source of truth.
 */

import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import type { Tx } from '@/server/db';
import {
  notifications,
  type Notification,
  type NotificationKind,
} from '@/server/db/schema/notifications';

export async function createNotification(
  tx: Tx,
  workspaceId: string,
  input: {
    userId: string;
    kind: NotificationKind;
    title: string;
    body?: string;
    href?: string;
    context?: Record<string, string>;
  },
): Promise<void> {
  await tx.insert(notifications).values({
    workspaceId,
    userId: input.userId,
    kind: input.kind,
    title: input.title,
    body: input.body ?? null,
    href: input.href ?? null,
    context: input.context ?? {},
  });
}

export async function listNotifications(
  tx: Tx,
  workspaceId: string,
  userId: string,
  opts: { unreadOnly?: boolean; kind?: NotificationKind; cursor?: string; limit?: number } = {},
): Promise<{ rows: Notification[]; nextCursor: string | null; unreadCount: number }> {
  const limit = Math.min(opts.limit ?? 20, 100);
  const rows = await tx
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        eq(notifications.userId, userId),
        opts.unreadOnly ? isNull(notifications.readAt) : undefined,
        opts.kind ? eq(notifications.kind, opts.kind) : undefined,
        opts.cursor ? lt(notifications.createdAt, new Date(opts.cursor)) : undefined,
      ),
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const [unread] = [
    ...(await tx.execute(sql`
      select count(*)::int as n from notifications
      where workspace_id = ${workspaceId}::uuid and user_id = ${userId}::uuid and read_at is null
    `)),
  ] as Array<{ n: number }>;

  return {
    rows: page,
    nextCursor: rows.length > limit ? (page[page.length - 1]?.createdAt.toISOString() ?? null) : null,
    unreadCount: unread?.n ?? 0,
  };
}

export async function markNotificationsRead(
  tx: Tx,
  workspaceId: string,
  userId: string,
  target: { ids: string[] } | { all: true },
): Promise<number> {
  const marked = await tx
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
        'ids' in target ? inArray(notifications.id, target.ids) : undefined,
      ),
    )
    .returning({ id: notifications.id });
  return marked.length;
}
