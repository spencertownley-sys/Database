export * from './_shared';
export * from './workspaces';
export * from './itemTypes';
export * from './items';
export * from './trees';
export * from './changeSets';
export * from './views';
export * from './imports';
export * from './apiKeys';
export * from './webhooks';
export * from './notifications';

import { workspaceMembers, guestScopes, users, workspaces } from './workspaces';
import { itemTypes, fieldGroups, fields } from './itemTypes';
import { items, itemFieldIndex } from './items';
import { trees, treeNodes, itemTreeNodes } from './trees';
import { changeSets, changeEntries } from './changeSets';
import { views } from './views';
import { importProfiles, importJobs, exportJobs } from './imports';
import { apiKeys } from './apiKeys';
import { webhooks, webhookDeliveries } from './webhooks';
import { notifications } from './notifications';

/**
 * Every table carrying `workspace_id`, and therefore every table that must
 * have RLS enabled and a policy keyed on `app.workspace_id`.
 *
 * The RLS migration and the tenant isolation test both read this list. Adding
 * a tenant table without adding it here means the table ships without a
 * policy — which is exactly the failure the isolation test exists to catch, so
 * the test asserts this list matches the database's own catalog.
 */
export const TENANT_TABLES = [
  'workspace_members',
  'guest_scopes',
  'item_types',
  'field_groups',
  'fields',
  'items',
  'item_field_index',
  'trees',
  'tree_nodes',
  'item_tree_nodes',
  'change_sets',
  'change_entries',
  'views',
  'import_profiles',
  'import_jobs',
  'export_jobs',
  'api_keys',
  'webhooks',
  'webhook_deliveries',
  'notifications',
] as const;

export type TenantTableName = (typeof TENANT_TABLES)[number];

/** Tables intentionally *not* tenant-scoped, with the reason. */
export const GLOBAL_TABLES: Record<string, string> = {
  users: 'A person may belong to several workspaces; membership is the scoping edge.',
  workspaces: 'The tenant root itself; access is resolved by membership in middleware.',
};

export const schema = {
  workspaces,
  users,
  workspaceMembers,
  guestScopes,
  itemTypes,
  fieldGroups,
  fields,
  items,
  itemFieldIndex,
  trees,
  treeNodes,
  itemTreeNodes,
  changeSets,
  changeEntries,
  views,
  importProfiles,
  importJobs,
  exportJobs,
  apiKeys,
  webhooks,
  webhookDeliveries,
  notifications,
};
