/**
 * The 100k-item × 40-field perf fixture (Tech Spec §8, Step 15).
 *
 * Built entirely in SQL with `generate_series` — pushing a million
 * `item_field_index` rows through the ORM would take longer than the tests.
 * Idempotent: reused when the workspace already holds the expected counts, so
 * the suite's steady-state cost is the queries, not the seed.
 *
 * Shape: 50k items at the root, plus a depth-8 ancestor chain whose deepest
 * node holds the other 50k — exactly the §6.1 subtree scale point.
 */

import { ownerClient } from '~/tests/integration/helpers/db';

export const PERF_SLUG = 'perf-100k';
export const PERF_TOTAL_ITEMS = 100_008; // 50k root + 8 chain + 50k leaves
export const PERF_SUBTREE_ITEMS = 50_001; // chain tail + its 50k children

const FIELD_COUNT = 40;

export interface PerfFixture {
  workspaceId: string;
  itemTypeId: string;
  /** Root of the depth-8 chain (subtree of ~50k). */
  chainRootId: string;
  /** The depth-8 node the 50k leaves hang from. */
  chainTailId: string;
}

export async function ensurePerfFixture(): Promise<PerfFixture> {
  const existing = await ownerClient<Array<{ id: string }>>`
    select id from workspaces where slug = ${PERF_SLUG}
  `;
  if (existing[0]) {
    const ws = existing[0].id;
    const [count] = await ownerClient<Array<{ n: number }>>`
      select count(*)::int as n from items where workspace_id = ${ws}
    `;
    if (count?.n === PERF_TOTAL_ITEMS) return describeFixture(ws);
    // Partial/stale build — start clean.
    await ownerClient`delete from workspaces where id = ${ws}`;
  }

  const started = Date.now();
  const [ws] = await ownerClient<Array<{ id: string }>>`
    insert into workspaces (name, slug) values ('Perf 100k', ${PERF_SLUG}) returning id
  `;
  const workspaceId = (ws as { id: string }).id;

  const [type] = await ownerClient<Array<{ id: string }>>`
    insert into item_types (workspace_id, key, label, plural_label)
    values (${workspaceId}, 'record', 'Record', 'Records') returning id
  `;
  const itemTypeId = (type as { id: string }).id;

  // 40 fields; the first 8 are the indexed scale-point set.
  await ownerClient`
    insert into fields (workspace_id, item_type_id, key, label, type, config, position, is_indexed, required_for_completeness)
    select
      ${workspaceId}, ${itemTypeId},
      'f' || g, 'Field ' || g,
      case
        when g <= 2 then 'select'
        when g <= 4 then 'number'
        when g <= 6 then 'date'
        when g = 7 then 'checkbox'
        else 'text'
      end::field_type,
      case when g <= 2 then '{"options": [
        {"id": "opt_a", "label": "Alpha", "order": 0},
        {"id": "opt_b", "label": "Beta", "order": 1},
        {"id": "opt_c", "label": "Gamma", "order": 2},
        {"id": "opt_d", "label": "Delta", "order": 3},
        {"id": "opt_e", "label": "Epsilon", "order": 4}
      ]}'::jsonb else '{}'::jsonb end,
      lpad(g::text, 4, '0'),
      g <= 8,
      g <= 4
    from generate_series(1, ${FIELD_COUNT}) g
  `;

  // The depth-8 chain, one node per level.
  await ownerClient`
    with recursive chain as (
      select 1 as lvl, gen_random_uuid() as id, null::uuid as parent_id, null::text as parent_path
      union all
      select lvl + 1, gen_random_uuid(), id, coalesce(parent_path || '.', '') || replace(id::text, '-', '_')
      from chain where lvl < 8
    )
    insert into items (id, workspace_id, item_type_id, title, parent_id, path, depth, position, values, effective_values, search_text)
    select
      id, ${workspaceId}, ${itemTypeId}, 'Chain level ' || lvl,
      parent_id,
      (coalesce(parent_path || '.', '') || replace(id::text, '-', '_'))::ltree,
      lvl - 1,
      'a' || lvl,
      '{}'::jsonb, '{}'::jsonb, 'chain level ' || lvl
    from chain
  `;

  const [tail] = await ownerClient<Array<{ id: string; path: string }>>`
    select id, path::text as path from items
    where workspace_id = ${workspaceId} and depth = 7 limit 1
  `;
  const tailId = (tail as { id: string; path: string }).id;
  const tailPath = (tail as { id: string; path: string }).path;

  // 50k root items + 50k leaves under the chain tail, in one statement each.
  for (const [count, parentId, parentPath, label] of [
    [50_000, null, null, 'Root record'],
    [50_000, tailId, tailPath, 'Deep record'],
  ] as const) {
    await ownerClient`
      with gen as (
        select gen_random_uuid() as id, g from generate_series(1, ${count}) g
      )
      insert into items (id, workspace_id, item_type_id, title, parent_id, path, depth, position,
                         values, effective_values, completeness_pct, search_text)
      select
        id, ${workspaceId}, ${itemTypeId},
        ${label} || ' ' || g,
        ${parentId}::uuid,
        case when ${parentPath}::text is null
          then replace(id::text, '-', '_')::ltree
          else (${parentPath}::text || '.' || replace(id::text, '-', '_'))::ltree
        end,
        case when ${parentPath}::text is null then 0 else 8 end,
        lpad(g::text, 8, '0'),
        jsonb_build_object(
          'f1', (array['opt_a','opt_b','opt_c','opt_d','opt_e'])[1 + g % 5],
          'f2', (array['opt_a','opt_b','opt_c'])[1 + g % 3],
          'f3', (g % 1000)::numeric,
          'f4', ((g * 7) % 500)::numeric,
          'f5', to_char(date '2026-01-01' + (g % 365), 'YYYY-MM-DD'),
          'f6', to_char(date '2026-06-01' + (g % 90), 'YYYY-MM-DD'),
          'f7', (g % 2 = 0),
          'f8', 'text value ' || (g % 100),
          'f9', 'filler ' || g
        ),
        jsonb_build_object(
          'f1', (array['opt_a','opt_b','opt_c','opt_d','opt_e'])[1 + g % 5],
          'f2', (array['opt_a','opt_b','opt_c'])[1 + g % 3],
          'f3', (g % 1000)::numeric,
          'f4', ((g * 7) % 500)::numeric,
          'f5', to_char(date '2026-01-01' + (g % 365), 'YYYY-MM-DD'),
          'f6', to_char(date '2026-06-01' + (g % 90), 'YYYY-MM-DD'),
          'f7', (g % 2 = 0),
          'f8', 'text value ' || (g % 100),
          'f9', 'filler ' || g
        ),
        100,
        lower(${label} || ' ' || g || ' text value ' || (g % 100))
      from gen
    `;
  }

  // Projection rows for the 8 indexed fields — one statement per storage class.
  await ownerClient`
    insert into item_field_index (workspace_id, item_id, field_id, item_type_id, value_text)
    select i.workspace_id, i.id, f.id, i.item_type_id, i.effective_values ->> f.key
    from items i
    join fields f on f.item_type_id = i.item_type_id and f.key in ('f1', 'f2', 'f8')
    where i.workspace_id = ${workspaceId} and i.effective_values ? f.key
  `;
  await ownerClient`
    insert into item_field_index (workspace_id, item_id, field_id, item_type_id, value_number)
    select i.workspace_id, i.id, f.id, i.item_type_id, (i.effective_values ->> f.key)::numeric
    from items i
    join fields f on f.item_type_id = i.item_type_id and f.key in ('f3', 'f4')
    where i.workspace_id = ${workspaceId} and i.effective_values ? f.key
  `;
  await ownerClient`
    insert into item_field_index (workspace_id, item_id, field_id, item_type_id, value_date)
    select i.workspace_id, i.id, f.id, i.item_type_id, (i.effective_values ->> f.key)::date
    from items i
    join fields f on f.item_type_id = i.item_type_id and f.key in ('f5', 'f6')
    where i.workspace_id = ${workspaceId} and i.effective_values ? f.key
  `;
  await ownerClient`
    insert into item_field_index (workspace_id, item_id, field_id, item_type_id, value_bool)
    select i.workspace_id, i.id, f.id, i.item_type_id, (i.effective_values ->> f.key)::boolean
    from items i
    join fields f on f.item_type_id = i.item_type_id and f.key = 'f7'
    where i.workspace_id = ${workspaceId} and i.effective_values ? f.key
  `;

  // VACUUM, not just ANALYZE: the bulk load leaves the trigram GIN's pending
  // list full, which inflates its cost estimate until a vacuum merges it —
  // and the planner then "correctly" seq-scans past the index.
  await ownerClient`vacuum analyze items`;
  await ownerClient`vacuum analyze item_field_index`;

   
  console.log(`Perf fixture built in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  return describeFixture(workspaceId);
}

async function describeFixture(workspaceId: string): Promise<PerfFixture> {
  const [type] = await ownerClient<Array<{ id: string }>>`
    select id from item_types where workspace_id = ${workspaceId} limit 1
  `;
  const [root] = await ownerClient<Array<{ id: string }>>`
    select id from items where workspace_id = ${workspaceId} and depth = 0 and title like 'Chain %' limit 1
  `;
  const [tail] = await ownerClient<Array<{ id: string }>>`
    select id from items where workspace_id = ${workspaceId} and depth = 7 limit 1
  `;
  return {
    workspaceId,
    itemTypeId: (type as { id: string }).id,
    chainRootId: (root as { id: string }).id,
    chainTailId: (tail as { id: string }).id,
  };
}
