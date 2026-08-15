import { sql } from 'drizzle-orm';
import type { AppTx } from './db';

/**
 * A canonical picture of everything a change set can touch.
 *
 * Deliberately includes the *derived* columns — `effective_values`,
 * `completeness_pct`, `missing_required`, `search_text`, `path`, and every
 * `item_field_index` row. Comparing only `values` would let an undo pass while
 * leaving the projection index describing a state that no longer exists, and a
 * filter reading that index would then silently omit real items.
 *
 * Excludes `updated_at` and `updated_by`: an undo is a new write and is
 * expected to move them. Including them would make the assertion impossible to
 * satisfy and tempt the next person to weaken it.
 */
export interface WorkspaceSnapshot {
  items: string;
  projection: string;
  memberships: string;
  treeCounts: string;
}

export async function snapshotWorkspace(
  tx: AppTx,
  workspaceId: string,
): Promise<WorkspaceSnapshot> {
  const items = await tx.execute(sql`
    select
      id, item_type_id, title, parent_id, path::text as path, order_key,
      is_variant_model, variant_of_id, variant_axis_values,
      values, effective_values, invalid_values,
      completeness_pct, missing_required, search_text, assignee_id,
      (deleted_at is not null) as is_deleted
    from items
    where workspace_id = ${workspaceId}
    order by id
  `);

  const projection = await tx.execute(sql`
    select item_id, field_id, item_type_id,
           value_text, value_number::text as value_number, value_date,
           value_bool, value_uuid, value_text_array
    from item_field_index
    where workspace_id = ${workspaceId}
    order by item_id, field_id
  `);

  const memberships = await tx.execute(sql`
    select item_id, tree_node_id from item_tree_nodes
    where workspace_id = ${workspaceId}
    order by item_id, tree_node_id
  `);

  const treeCounts = await tx.execute(sql`
    select id, item_count from tree_nodes
    where workspace_id = ${workspaceId}
    order by id
  `);

  return {
    items: canonical([...items]),
    projection: canonical([...projection]),
    memberships: canonical([...memberships]),
    treeCounts: canonical([...treeCounts]),
  };
}

/** Key-order-independent JSON so two equal states always stringify equally. */
export function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, val: unknown) => {
    if (val && typeof val === 'object' && !Array.isArray(val) && !(val instanceof Date)) {
      const record = val as Record<string, unknown>;
      return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = record[k];
          return acc;
        }, {});
    }
    return val;
  });
}
