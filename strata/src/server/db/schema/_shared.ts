import { customType, timestamp, uuid } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Postgres `ltree`. Drizzle has no native mapping, and the encoding rules live
 * in `src/server/lib/ltree.ts` — nothing should build one of these by hand.
 */
export const ltree = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'ltree';
  },
});

/** `citext`-like case-insensitive comparison is done in SQL; emails store raw. */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const primaryId = () => uuid('id').primaryKey().defaultRandom();

/**
 * Present on every tenant table. The RLS policy on each table compares this
 * against `current_setting('app.workspace_id')`, which `withWorkspace()` sets
 * transaction-locally. A tenant table without this column cannot be isolated.
 */
export const workspaceIdColumn = () => uuid('workspace_id').notNull();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`);

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' })
    .notNull()
    .default(sql`now()`);

export const deletedAt = () => timestamp('deleted_at', { withTimezone: true, mode: 'date' });
/** Soft delete under the spec's name for items and item types (Tech Spec §2.2–2.3). */
export const archivedAt = () => timestamp('archived_at', { withTimezone: true, mode: 'date' });

export const timestamps = () => ({
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
