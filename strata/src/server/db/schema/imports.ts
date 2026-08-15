import { relations } from 'drizzle-orm';
import {
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
import { primaryId, timestamps, workspaceIdColumn } from './_shared';
import { changeSets } from './changeSets';
import { itemTypes } from './itemTypes';
import { users, workspaces } from './workspaces';
import type { FilterGroup, SortSpec } from '@/types/filters';

export const importStatusEnum = pgEnum('import_status', [
  'uploaded',
  'parsing',
  'mapping',
  'validating',
  'validated',
  'committing',
  'committed',
  'failed',
  'cancelled',
]);

export const exportStatusEnum = pgEnum('export_status', [
  'queued',
  'generating',
  'ready',
  'failed',
  'expired',
]);

export const exportFormatEnum = pgEnum('export_format', ['csv', 'xlsx']);

/** A reusable column mapping, so the monthly import is configured once. */
export const importProfiles = pgTable(
  'import_profiles',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    itemTypeId: uuid('item_type_id')
      .notNull()
      .references(() => itemTypes.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Source column header → target field key (or a `$system` key). */
    mapping: jsonb('mapping').$type<Record<string, string>>().notNull().default({}),
    /** Field key used to match existing items; absent means always create. */
    matchKey: text('match_key'),
    options: jsonb('options').$type<ImportOptions>().notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
  },
  (t) => [uniqueIndex('import_profiles_ws_type_name_key').on(t.workspaceId, t.itemTypeId, t.name)],
);

export interface ImportOptions {
  hasHeaderRow?: boolean;
  delimiter?: string;
  encoding?: string;
  /** What to do when `matchKey` finds an existing item. */
  onMatch?: 'update' | 'skip';
  /** Assign every imported item to this tree node. */
  treeNodeId?: string;
  parentItemId?: string;
}

export const importJobs = pgTable(
  'import_jobs',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    itemTypeId: uuid('item_type_id')
      .notNull()
      .references(() => itemTypes.id, { onDelete: 'cascade' }),
    profileId: uuid('profile_id').references(() => importProfiles.id, { onDelete: 'set null' }),
    status: importStatusEnum('status').notNull().default('uploaded'),
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size').notNull().default(0),
    /** Supabase Storage object path. Never a client-supplied absolute URL. */
    storagePath: text('storage_path').notNull(),
    mimeType: text('mime_type'),
    mapping: jsonb('mapping').$type<Record<string, string>>().notNull().default({}),
    matchKey: text('match_key'),
    options: jsonb('options').$type<ImportOptions>().notNull().default({}),
    detectedHeaders: text('detected_headers').array(),
    previewRows: jsonb('preview_rows').$type<string[][]>(),
    rowCount: integer('row_count').notNull().default(0),
    newCount: integer('new_count').notNull().default(0),
    matchedCount: integer('matched_count').notNull().default(0),
    errorCount: integer('error_count').notNull().default(0),
    warningCount: integer('warning_count').notNull().default(0),
    report: jsonb('report').$type<ImportReport | null>(),
    /** Downloadable per-row error CSV produced by `importValidate`. */
    errorCsvPath: text('error_csv_path'),
    /** Imports commit through a change set, so they undo like everything else. */
    changeSetId: uuid('change_set_id').references(() => changeSets.id, { onDelete: 'set null' }),
    error: jsonb('error').$type<{ code: string; message: string } | null>(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [
    index('import_jobs_ws_created_idx').on(t.workspaceId, t.createdAt),
    index('import_jobs_status_idx').on(t.workspaceId, t.status),
  ],
);

export interface ImportReport {
  rowCount: number;
  newCount: number;
  matchedCount: number;
  columns: Array<{
    header: string;
    fieldKey: string | null;
    coerced: number;
    invalid: number;
    empty: number;
    samples: string[];
  }>;
  errors: Array<{ row: number; column: string; value: string; message: string }>;
}

export const exportJobs = pgTable(
  'export_jobs',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    itemTypeId: uuid('item_type_id').references(() => itemTypes.id, { onDelete: 'cascade' }),
    viewId: uuid('view_id'),
    status: exportStatusEnum('status').notNull().default('queued'),
    format: exportFormatEnum('format').notNull().default('csv'),
    /** Snapshot of the view at request time — the file must not drift. */
    query: jsonb('query').$type<{
      filter?: FilterGroup;
      sort?: SortSpec[];
      search?: string;
      visibleFieldKeys?: string[];
      groupFieldKey?: string;
    }>(),
    rowCount: integer('row_count').notNull().default(0),
    storagePath: text('storage_path'),
    /** Signed URLs are minted on read, never stored. */
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }),
    error: jsonb('error').$type<{ code: string; message: string } | null>(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
    completedAt: timestamp('completed_at', { withTimezone: true, mode: 'date' }),
  },
  (t) => [index('export_jobs_ws_created_idx').on(t.workspaceId, t.createdAt)],
);

export const importJobsRelations = relations(importJobs, ({ one }) => ({
  itemType: one(itemTypes, { fields: [importJobs.itemTypeId], references: [itemTypes.id] }),
  profile: one(importProfiles, {
    fields: [importJobs.profileId],
    references: [importProfiles.id],
  }),
  changeSet: one(changeSets, { fields: [importJobs.changeSetId], references: [changeSets.id] }),
}));

export type ImportProfile = typeof importProfiles.$inferSelect;
export type ImportJob = typeof importJobs.$inferSelect;
export type ExportJob = typeof exportJobs.$inferSelect;
