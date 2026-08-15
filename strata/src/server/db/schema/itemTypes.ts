import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { deletedAt, primaryId, timestamps, workspaceIdColumn } from './_shared';
import { users, workspaces } from './workspaces';
import type { FieldConfig, FieldType, InheritanceMode } from '@/types/fields';

export const fieldTypeEnum = pgEnum('field_type', [
  'text',
  'long_text',
  'number',
  'currency',
  'percent',
  'date',
  'datetime',
  'select',
  'multi_select',
  'checkbox',
  'url',
  'email',
  'user',
  'relation',
]);

export const inheritanceEnum = pgEnum('field_inheritance', ['shared', 'variant']);

/**
 * A reusable schema for a class of work: "Campaign", "Deliverable", "SKU".
 *
 * `variantAxes` names the `select` fields whose combinations generate
 * variants. It is a list of field *keys*, not ids, so a field can be renamed
 * without rewriting every type definition.
 */
export const itemTypes = pgTable(
  'item_types',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    pluralName: text('plural_name'),
    description: text('description'),
    icon: text('icon'),
    color: text('color'),
    /** Which preset it was created from, for concept hints and analytics. */
    presetKey: text('preset_key'),
    variantAxes: text('variant_axes').array().notNull().default(sql`'{}'::text[]`),
    /** Denormalised; maintained inside change-set commits. */
    itemCount: integer('item_count').notNull().default(0),
    defaultViewId: uuid('default_view_id'),
    isSystem: boolean('is_system').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('item_types_ws_key_key').on(t.workspaceId, t.key),
    index('item_types_ws_idx').on(t.workspaceId).where(sql`${t.deletedAt} is null`),
  ],
);

/** A collapsible section in the detail panel and the field picker. */
export const fieldGroups = pgTable(
  'field_groups',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    itemTypeId: uuid('item_type_id')
      .notNull()
      .references(() => itemTypes.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    description: text('description'),
    orderKey: text('order_key').notNull(),
    collapsedByDefault: boolean('collapsed_by_default').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('field_groups_type_key_key').on(t.itemTypeId, t.key),
    index('field_groups_type_order_idx').on(t.itemTypeId, t.orderKey),
  ],
);

/**
 * One typed attribute on an Item Type.
 *
 * `key` is immutable and is what `items.values` is keyed by; `label` is
 * presentation and may be renamed freely. Conflating them means a rename
 * rewrites every item's JSONB — the one operation guaranteed to lose data.
 */
export const fields = pgTable(
  'fields',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    itemTypeId: uuid('item_type_id')
      .notNull()
      .references(() => itemTypes.id, { onDelete: 'cascade' }),
    fieldGroupId: uuid('field_group_id').references(() => fieldGroups.id, { onDelete: 'set null' }),
    key: text('key').notNull(),
    label: text('label').notNull(),
    type: fieldTypeEnum('type').notNull().$type<FieldType>(),
    config: jsonb('config').$type<FieldConfig>().notNull().default({}),
    helpText: text('help_text'),
    /**
     * The one completeness flag (Tech Spec §2.2): an item's completeness is
     * filled-required ÷ total-required, nothing else. There is deliberately no
     * second "counts toward completeness" knob — PRD §4.7 defines the metric
     * over required fields only.
     */
    requiredForCompleteness: boolean('required_for_completeness').notNull().default(false),
    defaultValue: jsonb('default_value'),
    /**
     * `'shared'`  — owned by the model, read-only on variants (Tech Spec §2.5).
     * `'variant'` — owned per variant, inheriting the model's value until
     * overridden. The default is `'variant'`: a new field starts overridable,
     * and locking it to the model is the deliberate act.
     */
    inheritance: inheritanceEnum('inheritance').notNull().default('variant').$type<InheritanceMode>(),
    /**
     * Whether values are projected into `item_field_index`. Flipped on
     * automatically the first time a field is filtered or sorted, which
     * enqueues `fieldBackfill`. Indexing every field up front triples write
     * cost for fields nobody ever filters.
     */
    isIndexed: boolean('is_indexed').notNull().default(false),
    /** Contributes to `items.search_text`. */
    isSearchable: boolean('is_searchable').notNull().default(false),
    orderKey: text('order_key').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    ...timestamps(),
    /** Soft delete: values are retained for a 30-day restore window. */
    deletedAt: deletedAt(),
  },
  (t) => [
    // A restored field must not collide with one created in the meantime, so
    // uniqueness only covers live fields.
    uniqueIndex('fields_type_key_key')
      .on(t.itemTypeId, t.key)
      .where(sql`${t.deletedAt} is null`),
    index('fields_type_order_idx').on(t.itemTypeId, t.orderKey).where(sql`${t.deletedAt} is null`),
    index('fields_ws_idx').on(t.workspaceId),
    index('fields_indexed_idx').on(t.itemTypeId).where(sql`${t.isIndexed} = true`),
  ],
);

export const itemTypesRelations = relations(itemTypes, ({ many, one }) => ({
  fields: many(fields),
  fieldGroups: many(fieldGroups),
  workspace: one(workspaces, { fields: [itemTypes.workspaceId], references: [workspaces.id] }),
}));

export const fieldsRelations = relations(fields, ({ one }) => ({
  itemType: one(itemTypes, { fields: [fields.itemTypeId], references: [itemTypes.id] }),
  group: one(fieldGroups, { fields: [fields.fieldGroupId], references: [fieldGroups.id] }),
}));

export const fieldGroupsRelations = relations(fieldGroups, ({ one, many }) => ({
  itemType: one(itemTypes, { fields: [fieldGroups.itemTypeId], references: [itemTypes.id] }),
  fields: many(fields),
}));

export type ItemType = typeof itemTypes.$inferSelect;
export type NewItemType = typeof itemTypes.$inferInsert;
export type Field = typeof fields.$inferSelect;
export type NewField = typeof fields.$inferInsert;
export type FieldGroup = typeof fieldGroups.$inferSelect;
