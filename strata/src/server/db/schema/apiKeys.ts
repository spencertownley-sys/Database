import { relations, sql } from 'drizzle-orm';
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { primaryId, timestamps, workspaceIdColumn } from './_shared';
import { users, workspaceMembers, workspaces } from './workspaces';

/**
 * A workspace API key.
 *
 * Only the SHA-256 of `pepper || secret` is stored — the plaintext is shown
 * once at creation and never again. `prefix` is the first few characters,
 * kept in clear so the settings screen can identify a key without being able
 * to authenticate as it.
 *
 * A key inherits the *member's* role, and a key whose member is a `guest` is
 * rejected at authentication time. That rejection is what contains the v1
 * field-permission gap: guests have a presentation-level field subset, and
 * the API has no such subsetting, so guests do not get the API at all.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => workspaceMembers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    prefix: text('prefix').notNull(),
    hashedKey: text('hashed_key').notNull(),
    /** Granular scopes (API Design §9); the role still gates everything the scope allows. */
    scopes: text('scopes').array().notNull().default(sql`'{items:read}'::text[]`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('api_keys_hashed_key').on(t.hashedKey),
    index('api_keys_ws_idx').on(t.workspaceId).where(sql`${t.revokedAt} is null`),
    index('api_keys_prefix_idx').on(t.prefix),
  ],
);

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  member: one(workspaceMembers, {
    fields: [apiKeys.memberId],
    references: [workspaceMembers.id],
  }),
}));

export type ApiKey = typeof apiKeys.$inferSelect;
export const API_KEY_SCOPES = [
  'items:read',
  'items:write',
  'schema:read',
  'schema:write',
  'trees:read',
  'trees:write',
  'views:read',
  'views:write',
  'imports:write',
  'exports:write',
  'webhooks:manage',
] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];
