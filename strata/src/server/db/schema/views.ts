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
import { itemTypes } from './itemTypes';
import { users, workspaces } from './workspaces';
import type { FilterGroup, GroupSpec, SortSpec } from '@/types/filters';

export const viewKindEnum = pgEnum('view_kind', ['grid', 'list', 'board']);
export const viewVisibilityEnum = pgEnum('view_visibility', ['private', 'workspace', 'shared']);

/**
 * A saved lens over one Item Type. Grid, list, and board are three renderings
 * of the *same* config — switching type preserves filters and sort, which is
 * a Step 8 acceptance criterion, so the filter/sort/group fields must stay
 * type-agnostic.
 */
export const views = pgTable(
  'views',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    itemTypeId: uuid('item_type_id')
      .notNull()
      .references(() => itemTypes.id, { onDelete: 'cascade' }),
    type: viewKindEnum('type').notNull().default('grid'),
    name: text('name').notNull(),
    description: text('description'),
    visibility: viewVisibilityEnum('visibility').notNull().default('private'),
    config: jsonb('config').$type<ViewConfig>().notNull().default({}),
    /**
     * Present only for `visibility = 'shared'`. The `/share/[token]` route it
     * unlocks is read-only and unauthenticated by construction: an anonymous
     * request has no member row to scope edits against.
     */
    shareToken: text('share_token'),
    isDefault: boolean('is_default').notNull().default(false),
    ownerId: uuid('owner_id').references(() => users.id, { onDelete: 'set null' }),
    position: integer('position').notNull().default(0),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('views_share_token_key')
      .on(t.shareToken)
      .where(sql`${t.shareToken} is not null`),
    index('views_ws_type_idx').on(t.workspaceId, t.itemTypeId).where(sql`${t.deletedAt} is null`),
    index('views_owner_idx').on(t.workspaceId, t.ownerId),
  ],
);

export interface ViewConfig {
  filter?: FilterGroup;
  sort?: SortSpec[];
  group?: GroupSpec;
  search?: string;
  incompleteOnly?: boolean;
  /** Field keys in display order. Absent means "all live fields". */
  visibleFieldKeys?: string[];
  columnWidths?: Record<string, number>;
  /** Leading columns frozen during horizontal scroll. */
  pinnedFieldKeys?: string[];
  rowHeight?: 'compact' | 'normal' | 'tall';
  /** Board only: which `select`/`user` field forms the columns. */
  boardGroupFieldKey?: string;
  boardColumnOrder?: string[];
  boardWipLimits?: Record<string, number>;
  /** Tree node scoping applied on top of `filter`. */
  treeNodeId?: string;
  treeIncludeDescendants?: boolean;
}

export const viewsRelations = relations(views, ({ one }) => ({
  itemType: one(itemTypes, { fields: [views.itemTypeId], references: [itemTypes.id] }),
  owner: one(users, { fields: [views.ownerId], references: [users.id] }),
}));

export type View = typeof views.$inferSelect;
export type NewView = typeof views.$inferInsert;
export type ViewKind = (typeof viewKindEnum.enumValues)[number];
