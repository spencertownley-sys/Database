import { relations, sql } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { deletedAt, ltree, primaryId, timestamps, workspaceIdColumn } from './_shared';
import { itemTypes, fields } from './itemTypes';
import { users, workspaces } from './workspaces';
import type { InvalidValue } from '@/types/fields';

export type ItemValues = Record<string, unknown>;
export type InvalidValues = Record<string, InvalidValue>;

/**
 * The unit of work. One row carries three independent positions:
 *
 *   - the **work hierarchy** (`parent_id` + `path`),
 *   - **category trees** (many-to-many via `item_tree_nodes`),
 *   - **variant inheritance** (`variant_of_id` / `is_variant_model`).
 *
 * They are deliberately not the same axis. Collapsing any two of them is the
 * modelling mistake this product exists to avoid.
 *
 * `values` holds what this item owns. `effective_values` is the resolved view
 * after variant inheritance and is what everything downstream reads —
 * completeness, the projection index, exports, the grid. It is derived and
 * recomputed inside every change-set commit; never treat it as input.
 */
export const items = pgTable(
  'items',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    itemTypeId: uuid('item_type_id')
      .notNull()
      .references(() => itemTypes.id, { onDelete: 'restrict' }),
    title: text('title').notNull().default(''),

    // --- work hierarchy -----------------------------------------------------
    parentId: uuid('parent_id').references((): AnyPgColumn => items.id, { onDelete: 'cascade' }),
    /** Self-inclusive ltree path of encoded ancestor ids. See lib/ltree.ts. */
    path: ltree('path').notNull(),
    orderKey: text('order_key').notNull(),

    // --- variants -----------------------------------------------------------
    isVariantModel: boolean('is_variant_model').notNull().default(false),
    variantOfId: uuid('variant_of_id').references((): AnyPgColumn => items.id, {
      onDelete: 'cascade',
    }),
    /** `{ region: 'opt_emea', size: 'opt_lg' }` — the axis coordinates. */
    variantAxisValues: jsonb('variant_axis_values').$type<Record<string, string>>(),

    // --- values -------------------------------------------------------------
    values: jsonb('values').$type<ItemValues>().notNull().default({}),
    effectiveValues: jsonb('effective_values').$type<ItemValues>().notNull().default({}),
    /**
     * Per-field coercion failures. A bad value lands here and the rest of the
     * item still commits — rejecting a whole row because one cell says "TBD"
     * loses real work and reads as data loss.
     */
    invalidValues: jsonb('invalid_values').$type<InvalidValues>().notNull().default({}),

    // --- derived ------------------------------------------------------------
    completenessPct: integer('completeness_pct').notNull().default(0),
    missingRequired: text('missing_required').array().notNull().default(sql`'{}'::text[]`),
    searchText: text('search_text').notNull().default(''),

    assigneeId: uuid('assignee_id').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    // A variant model is neither a variant child nor a work-hierarchy child.
    check(
      'items_variant_model_is_root',
      sql`not ${t.isVariantModel} or (${t.parentId} is null and ${t.variantOfId} is null)`,
    ),
    // Variants are not nested inside the work hierarchy (out of scope for v1).
    check(
      'items_variant_not_in_hierarchy',
      sql`${t.variantOfId} is null or ${t.parentId} is null`,
    ),

    // Subtree reads are `path <@ :ancestor`; GiST is the operator's index.
    index('items_path_gist').using('gist', t.path),
    // Substring search over title + searchable fields.
    index('items_search_trgm').using('gin', sql`${t.searchText} gin_trgm_ops`),

    index('items_ws_type_idx')
      .on(t.workspaceId, t.itemTypeId, t.orderKey)
      .where(sql`${t.deletedAt} is null`),
    index('items_parent_idx').on(t.parentId, t.orderKey).where(sql`${t.deletedAt} is null`),
    index('items_variant_of_idx')
      .on(t.variantOfId)
      .where(sql`${t.variantOfId} is not null and ${t.deletedAt} is null`),
    index('items_assignee_idx')
      .on(t.workspaceId, t.assigneeId)
      .where(sql`${t.assigneeId} is not null and ${t.deletedAt} is null`),
    // Backs the "incomplete only" toggle without scanning complete items.
    index('items_incomplete_idx')
      .on(t.workspaceId, t.itemTypeId, t.completenessPct)
      .where(sql`${t.completenessPct} < 100 and ${t.deletedAt} is null`),
    index('items_updated_idx').on(t.workspaceId, t.updatedAt),
  ],
);

/**
 * The projection index — the read path for filtering and sorting.
 *
 * **Derived, always.** Every row here is reconstructible from
 * `items.effective_values` plus the field definitions, and `projectionAudit`
 * samples 1% nightly to prove it still is. Writing to this table as a primary
 * source creates a second truth that will silently diverge and produce
 * filters that omit real items — the worst possible failure in a work tool.
 *
 * One typed column per storage class rather than a JSONB probe: a partial
 * B-tree on `value_number` is an index range scan, while a JSONB extraction
 * is a filter applied after the rows are already read.
 */
export const itemFieldIndex = pgTable(
  'item_field_index',
  {
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    fieldId: uuid('field_id')
      .notNull()
      .references(() => fields.id, { onDelete: 'cascade' }),
    /** Denormalised so a type-scoped filter never joins back to `items`. */
    itemTypeId: uuid('item_type_id').notNull(),

    valueText: text('value_text'),
    valueNumber: numeric('value_number', { precision: 38, scale: 10, mode: 'number' }),
    valueDate: timestamp('value_date', { withTimezone: true, mode: 'date' }),
    valueBool: boolean('value_bool'),
    valueUuid: uuid('value_uuid'),
    valueTextArray: text('value_text_array').array(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.fieldId] }),
    // Partial indexes: a field only ever populates one value column, so a full
    // index would be mostly NULLs and several times the size.
    index('ifi_field_text_idx')
      .on(t.fieldId, t.valueText)
      .where(sql`${t.valueText} is not null`),
    index('ifi_field_number_idx')
      .on(t.fieldId, t.valueNumber)
      .where(sql`${t.valueNumber} is not null`),
    index('ifi_field_date_idx')
      .on(t.fieldId, t.valueDate)
      .where(sql`${t.valueDate} is not null`),
    index('ifi_field_bool_idx')
      .on(t.fieldId, t.valueBool)
      .where(sql`${t.valueBool} is not null`),
    index('ifi_field_uuid_idx')
      .on(t.fieldId, t.valueUuid)
      .where(sql`${t.valueUuid} is not null`),
    index('ifi_field_array_idx')
      .using('gin', t.valueTextArray)
      .where(sql`${t.valueTextArray} is not null`),
    index('ifi_ws_type_idx').on(t.workspaceId, t.itemTypeId),
  ],
);

export const itemsRelations = relations(items, ({ one, many }) => ({
  itemType: one(itemTypes, { fields: [items.itemTypeId], references: [itemTypes.id] }),
  parent: one(items, {
    fields: [items.parentId],
    references: [items.id],
    relationName: 'itemHierarchy',
  }),
  children: many(items, { relationName: 'itemHierarchy' }),
  variantModel: one(items, {
    fields: [items.variantOfId],
    references: [items.id],
    relationName: 'itemVariants',
  }),
  variants: many(items, { relationName: 'itemVariants' }),
  assignee: one(users, { fields: [items.assigneeId], references: [users.id] }),
  indexEntries: many(itemFieldIndex),
}));

export const itemFieldIndexRelations = relations(itemFieldIndex, ({ one }) => ({
  item: one(items, { fields: [itemFieldIndex.itemId], references: [items.id] }),
  field: one(fields, { fields: [itemFieldIndex.fieldId], references: [fields.id] }),
}));

export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
export type ItemFieldIndexRow = typeof itemFieldIndex.$inferSelect;
