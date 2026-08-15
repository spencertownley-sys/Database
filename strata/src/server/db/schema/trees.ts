import { relations } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, ltree, primaryId, timestamps, workspaceIdColumn } from './_shared';
import { items } from './items';
import { users, workspaces } from './workspaces';

/**
 * A category taxonomy, independent of the work hierarchy. v1 ships one
 * built-in tree plus at most one user-created tree per workspace.
 */
export const trees = pgTable(
  'trees',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon'),
    isBuiltIn: boolean('is_built_in').notNull().default(false),
    ...timestamps(),
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex('trees_ws_key_key').on(t.workspaceId, t.key)],
);

export const treeNodes = pgTable(
  'tree_nodes',
  {
    id: primaryId(),
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => treeNodes.id, {
      onDelete: 'cascade',
    }),
    /** Self-inclusive, same encoding as `items.path`. */
    path: ltree('path').notNull(),
    orderKey: text('order_key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    color: text('color'),
    /**
     * Direct memberships only — descendant rollups are computed in a single
     * grouped query rather than stored, so a reparent does not have to
     * rewrite counts up two ancestor chains.
     */
    itemCount: integer('item_count').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index('tree_nodes_path_gist').using('gist', t.path),
    index('tree_nodes_tree_parent_idx').on(t.treeId, t.parentId, t.orderKey),
    index('tree_nodes_ws_idx').on(t.workspaceId),
  ],
);

/** Many-to-many: an item can sit in several nodes across several trees. */
export const itemTreeNodes = pgTable(
  'item_tree_nodes',
  {
    workspaceId: workspaceIdColumn().references(() => workspaces.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    treeNodeId: uuid('tree_node_id')
      .notNull()
      .references(() => treeNodes.id, { onDelete: 'cascade' }),
    treeId: uuid('tree_id')
      .notNull()
      .references(() => trees.id, { onDelete: 'cascade' }),
    assignedBy: uuid('assigned_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.treeNodeId] }),
    index('itn_node_idx').on(t.treeNodeId),
    index('itn_ws_tree_idx').on(t.workspaceId, t.treeId),
  ],
);

export const treesRelations = relations(trees, ({ many }) => ({ nodes: many(treeNodes) }));

export const treeNodesRelations = relations(treeNodes, ({ one, many }) => ({
  tree: one(trees, { fields: [treeNodes.treeId], references: [trees.id] }),
  parent: one(treeNodes, {
    fields: [treeNodes.parentId],
    references: [treeNodes.id],
    relationName: 'treeHierarchy',
  }),
  children: many(treeNodes, { relationName: 'treeHierarchy' }),
  memberships: many(itemTreeNodes),
}));

export const itemTreeNodesRelations = relations(itemTreeNodes, ({ one }) => ({
  item: one(items, { fields: [itemTreeNodes.itemId], references: [items.id] }),
  node: one(treeNodes, { fields: [itemTreeNodes.treeNodeId], references: [treeNodes.id] }),
}));

export type Tree = typeof trees.$inferSelect;
export type TreeNode = typeof treeNodes.$inferSelect;
export type ItemTreeNode = typeof itemTreeNodes.$inferSelect;

/** v1 caps user-created trees; the built-in one does not count. */
export const MAX_USER_TREES = 1;
