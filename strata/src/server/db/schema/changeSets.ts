import { relations, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, workspaceIdColumn } from './_shared';
import { itemTypes } from './itemTypes';
import { items } from './items';
import { users, workspaces } from './workspaces';

/**
 * The nine user-initiated operations, plus one the system owns.
 *
 * `variant_propagate` is emitted by `variants.service.ts` when a shared field
 * on a model changes. It is never user-initiated: a user edits the model, and
 * propagation is the consequence. Exposing it in the API would let a caller
 * write variant values without going through inheritance resolution.
 */
export const changeOperationEnum = pgEnum('change_operation', [
  'create',
  'set_field',
  'clear_field',
  'change_type',
  'reparent',
  'tree_assign',
  'tree_unassign',
  'delete',
  'assign_user',
  'variant_propagate',
]);

export const changeSetStatusEnum = pgEnum('change_set_status', [
  'preview',
  'committing',
  'committed',
  'undone',
  'failed',
  'expired',
]);

export const changeSourceEnum = pgEnum('change_source', [
  'user',
  'api',
  'import',
  'undo',
  'job',
  'system',
]);

/**
 * Every write in the product is a change set. Not most writes — every write,
 * including a single cell edit, which is what makes Ctrl+Z behave identically
 * for one cell and for a 300-row bulk edit.
 *
 * Lifecycle: `preview` (nothing written to `items`) → `committing` → either
 * `committed` or `failed`. An `undo` creates a *second* change set holding the
 * inverse, links back via `parentChangeSetId`, and marks the original `undone`.
 * The inverse is a first-class record so undo is itself auditable and, if it
 * ever needs to be, undoable.
 */
export const changeSets = pgTable(
  'change_sets',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    operation: changeOperationEnum('operation').notNull(),
    status: changeSetStatusEnum('status').notNull().default('preview'),
    source: changeSourceEnum('source').notNull().default('user'),

    itemTypeId: uuid('item_type_id').references(() => itemTypes.id, { onDelete: 'set null' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    /** Set when the write arrived through `/api/v1` with a key rather than a session. */
    actorApiKeyId: uuid('actor_api_key_id'),

    /** How the affected set was selected: explicit ids, a filter, or a subtree. */
    target: jsonb('target').$type<ChangeTarget>().notNull(),
    /** What to do to each affected item. Shape depends on `operation`. */
    patch: jsonb('patch').$type<Record<string, unknown>>().notNull().default({}),

    itemCount: integer('item_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    /** Counts by outcome plus per-field deltas, rendered by the preview modal. */
    summary: jsonb('summary').$type<ChangeSummary>().notNull().default({ byField: {} }),
    /** First 20 entries, so the preview renders without loading every entry. */
    sampleEntries: jsonb('sample_entries').$type<SampleEntry[]>().notNull().default([]),

    /** The change set this one inverts (set on undo sets). */
    parentChangeSetId: uuid('parent_change_set_id').references((): AnyPgColumn => changeSets.id, {
      onDelete: 'set null',
    }),
    /** The undo set that reverted this one. */
    undoneByChangeSetId: uuid('undone_by_change_set_id'),

    idempotencyKey: text('idempotency_key'),
    /** Set when the commit was handed to `bulkCommit` above the sync threshold. */
    jobId: text('job_id'),
    progress: integer('progress').notNull().default(0),
    error: jsonb('error').$type<{ code: string; message: string; details?: unknown } | null>(),

    createdAt: createdAt(),
    committedAt: timestamp('committed_at', { withTimezone: true, mode: 'date' }),
    undoneAt: timestamp('undone_at', { withTimezone: true, mode: 'date' }),
    /** Previews are garbage-collected; a stale one must not commit silently. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    uniqueIndex('change_sets_idempotency_key')
      .on(t.workspaceId, t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index('change_sets_ws_created_idx').on(t.workspaceId, t.createdAt),
    index('change_sets_ws_status_idx').on(t.workspaceId, t.status),
    index('change_sets_actor_idx').on(t.workspaceId, t.actorId, t.createdAt),
  ],
);

/**
 * One row per affected item, holding the exact before/after so undo is a
 * replay rather than a recomputation. `before` is also the staleness check:
 * commit compares it against the item's current state and fails the whole
 * change set on a mismatch rather than clobbering someone else's edit.
 */
export const changeEntries = pgTable(
  'change_entries',
  {
    /** bigserial, not uuid: the highest-volume table gets 8-byte keys (§2.7). */
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    changeSetId: uuid('change_set_id')
      .notNull()
      .references(() => changeSets.id, { onDelete: 'cascade' }),
    /**
     * Deliberately *not* a foreign key.
     *
     * A change entry is an audit record, and its lifetime is not the item's.
     * A `create` preview writes the entry before the item exists, and an
     * entry must survive the item being hard-deleted — otherwise the activity
     * feed loses the record of the deletion itself. Tenant scoping comes from
     * `workspace_id`, which is a real FK and carries the RLS policy.
     */
    itemId: uuid('item_id'),
    seq: integer('seq').notNull().default(0),
    before: jsonb('before').$type<Record<string, unknown> | null>(),
    after: jsonb('after').$type<Record<string, unknown> | null>(),
    /** Skipped by permission or validation; the rest of the set still applies. */
    skipped: boolean('skipped').notNull().default(false),
    skipReason: text('skip_reason'),
    /**
     * Remove the row outright instead of soft-deleting it.
     *
     * Set only when undoing a `create`: the item never existed before that
     * change set, so leaving a tombstone would mean undoing a 200-row paste
     * left 200 invisible rows behind forever. A user-initiated `delete` is
     * always soft, so that its own undo is a restore.
     */
    hardDelete: boolean('hard_delete').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    index('change_entries_set_idx').on(t.changeSetId, t.seq),
    // Backs the per-item activity feed.
    index('change_entries_item_idx').on(t.workspaceId, t.itemId, t.createdAt),
  ],
);

/** A single item to be created by a `create` change set. */
export interface ItemDraft {
  title: string;
  values?: Record<string, unknown>;
  parentId?: string | null;
  treeNodeIds?: string[];
  itemTypeId?: string;
  /** Set when generating variants of a model. */
  variantParentId?: string | null;
  isVariantModel?: boolean;
  variantAxisValues?: Record<string, string> | null;
}

export interface ChangeTarget {
  kind: 'ids' | 'filter' | 'subtree' | 'new';
  itemIds?: string[];
  /** Serialized FilterGroup, resolved to concrete ids at preview time. */
  filter?: unknown;
  rootItemId?: string;
  includeDescendants?: boolean;
  /** For `create`: the items to create and their seed values. */
  drafts?: ItemDraft[];
}

export interface ChangeSummary {
  byField: Record<string, { changed: number; unchanged: number; invalid: number }>;
  created?: number;
  deleted?: number;
  moved?: number;
  assigned?: number;
  unassigned?: number;
  completenessDelta?: { before: number; after: number };
  skips?: Array<{ reason: string; count: number }>;
}

export interface SampleEntry {
  itemId: string | null;
  title: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  skipped?: boolean;
  skipReason?: string;
}

export const changeSetsRelations = relations(changeSets, ({ many, one }) => ({
  entries: many(changeEntries),
  parent: one(changeSets, {
    fields: [changeSets.parentChangeSetId],
    references: [changeSets.id],
    relationName: 'changeSetUndo',
  }),
  actor: one(users, { fields: [changeSets.actorId], references: [users.id] }),
}));

export const changeEntriesRelations = relations(changeEntries, ({ one }) => ({
  changeSet: one(changeSets, {
    fields: [changeEntries.changeSetId],
    references: [changeSets.id],
  }),
  item: one(items, { fields: [changeEntries.itemId], references: [items.id] }),
}));

export type ChangeSet = typeof changeSets.$inferSelect;
export type NewChangeSet = typeof changeSets.$inferInsert;
export type ChangeEntry = typeof changeEntries.$inferSelect;
export type ChangeOperation = (typeof changeOperationEnum.enumValues)[number];
export type ChangeSetStatus = (typeof changeSetStatusEnum.enumValues)[number];
export type ChangeSource = (typeof changeSourceEnum.enumValues)[number];

/** The nine operations a user may initiate. `variant_propagate` is excluded. */
export const USER_OPERATIONS = [
  'create',
  'set_field',
  'clear_field',
  'change_type',
  'reparent',
  'tree_assign',
  'tree_unassign',
  'delete',
  'assign_user',
] as const satisfies readonly ChangeOperation[];

export type UserOperation = (typeof USER_OPERATIONS)[number];

export function isUserOperation(op: string): op is UserOperation {
  return (USER_OPERATIONS as readonly string[]).includes(op);
}
