/**
 * Tenant isolation — the highest-consequence invariant in the codebase.
 *
 * The failure this guards against is not "a query returned too many rows". It
 * is one customer's item titles, budgets, and client names appearing inside
 * another customer's grid. There is no graceful degradation from that, and it
 * is invisible in single-tenant development, which is why the seed makes both
 * workspaces look alike and why these tests connect as the *application's*
 * role rather than the owner's.
 *
 * Four properties are asserted:
 *
 *   1. Every tenant table has RLS enabled *and forced*, and a policy.
 *   2. A query that forgets `WHERE workspace_id` still cannot cross tenants.
 *   3. With no workspace pinned, reads return nothing — fail closed, not open.
 *   4. Writes cannot smuggle another tenant's `workspace_id` past WITH CHECK.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  appClient,
  asWorkspace,
  closeTestDb,
  ownerClient,
  withNoWorkspace,
  workspaceIdBySlug,
} from './helpers/db';
import { TENANT_TABLES } from '@/server/db/schema';

let northwind: string;
let partners: string;

/** Unwraps drizzle's error wrapper to reach the driver's SQLSTATE. */
function sqlStateOf(e: unknown): string | null {
  let cursor: unknown = e;
  for (let depth = 0; cursor && depth < 5; depth += 1) {
    const code = (cursor as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return null;
}

beforeAll(async () => {
  northwind = await workspaceIdBySlug('northwind');
  partners = await workspaceIdBySlug('northwind-partners');
});

afterAll(async () => {
  await closeTestDb();
});

describe('database configuration', () => {
  it('enables and forces row-level security on every tenant table', async () => {
    const rows = await ownerClient<
      Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`
      select c.relname, c.relrowsecurity, c.relforcerowsecurity
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    `;
    const byName = new Map(rows.map((r) => [r.relname, r]));

    for (const table of TENANT_TABLES) {
      const row = byName.get(table);
      expect(row, `${table} is missing from the database`).toBeDefined();
      expect(row?.relrowsecurity, `${table} does not have RLS enabled`).toBe(true);
      // Without FORCE, the table owner bypasses every policy — and the owner
      // is exactly who a misconfigured deployment connects as.
      expect(row?.relforcerowsecurity, `${table} does not FORCE RLS`).toBe(true);
    }
  });

  it('has an isolation policy on every tenant table', async () => {
    const rows = await ownerClient<Array<{ tablename: string; qual: string | null }>>`
      select tablename, qual from pg_policies where schemaname = 'public'
    `;
    for (const table of TENANT_TABLES) {
      const policy = rows.find((r) => r.tablename === table);
      expect(policy, `${table} has no RLS policy`).toBeDefined();
      expect(policy?.qual ?? '').toContain('app_current_workspace_id');
    }
  });

  it('does not run tests as a role that bypasses RLS', async () => {
    const rows = await appClient<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`
      select rolsuper, rolbypassrls from pg_roles where rolname = current_user
    `;
    // If this fails the whole suite is theatre: every assertion below would
    // pass against a database with no policies at all.
    expect(rows[0]?.rolsuper, 'test connection is a superuser').toBe(false);
    expect(rows[0]?.rolbypassrls, 'test connection has BYPASSRLS').toBe(false);
  });
});

describe('reads', () => {
  it('returns only the pinned workspace, with no WHERE clause at all', async () => {
    // Deliberately omitting `where workspace_id = …` — the point is that the
    // policy, not the query, is what keeps the tenants apart.
    const inNorthwind = await asWorkspace(northwind, async (tx) => {
      const result = await tx.execute(sql`select workspace_id, title from items`);
      return [...result] as Array<{ workspace_id: string; title: string }>;
    });

    expect(inNorthwind.length).toBeGreaterThan(50);
    const foreign = inNorthwind.filter((r) => r.workspace_id !== northwind);
    expect(foreign, 'rows from another workspace leaked into an unfiltered read').toEqual([]);
  });

  it('cannot reach a known-good id from the other workspace', async () => {
    const [partnerItem] = await ownerClient<Array<{ id: string; title: string }>>`
      select id, title from items where workspace_id = ${partners} limit 1
    `;
    expect(partnerItem).toBeDefined();

    const found = await asWorkspace(northwind, async (tx) => {
      const result = await tx.execute(
        sql`select id from items where id = ${partnerItem?.id ?? ''}`,
      );
      return [...result];
    });
    expect(found).toEqual([]);
  });

  it('isolates every tenant table, not just items', async () => {
    for (const table of TENANT_TABLES) {
      const rows = await asWorkspace(northwind, async (tx) => {
        const result = await tx.execute(
          sql`select workspace_id from ${sql.identifier(table)} limit 500`,
        );
        return [...result] as Array<{ workspace_id: string }>;
      });
      const foreign = rows.filter((r) => r.workspace_id !== northwind);
      expect(foreign, `${table} leaked rows across workspaces`).toEqual([]);
    }
  });

  it('does not leak through a join that forgets to scope the joined side', async () => {
    const rows = await asWorkspace(northwind, async (tx) => {
      const result = await tx.execute(sql`
        select i.workspace_id as item_ws, f.workspace_id as field_ws
        from items i
        join item_field_index ifi on ifi.item_id = i.id
        join fields f on f.id = ifi.field_id
        limit 200
      `);
      return [...result] as Array<{ item_ws: string; field_ws: string }>;
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.item_ws).toBe(northwind);
      expect(row.field_ws).toBe(northwind);
    }
  });

  it('fails closed when no workspace is pinned', async () => {
    const rows = await withNoWorkspace(async (tx) => {
      const result = await tx.execute(sql`select id from items limit 10`);
      return [...result];
    });
    // NULL context must mean "nothing", never "everything".
    expect(rows).toEqual([]);
  });

  it('does not let workspace context survive between transactions on a pooled connection', async () => {
    // The `SET` vs `SET LOCAL` bug: a session-scoped GUC survives the
    // transaction and hands this tenant's context to the next request that
    // happens to pick up the same pooled connection.
    await asWorkspace(northwind, async (tx) => {
      const result = await tx.execute(sql`select count(*)::int as n from items`);
      expect(Number(([...result][0] as { n: number }).n)).toBeGreaterThan(0);
    });

    const leaked = await withNoWorkspace(async (tx) => {
      const result = await tx.execute(
        sql`select current_setting('app.workspace_id', true) as ws`,
      );
      return ([...result][0] as { ws: string | null }).ws;
    });
    expect(leaked === null || leaked === '').toBe(true);
  });
});

describe('writes', () => {
  it('rejects an insert carrying another workspace id', async () => {
    // Asserted on SQLSTATE rather than message text: drizzle wraps the driver
    // error, and `42501` (insufficient_privilege) is specifically what a
    // WITH CHECK failure raises — a message match would also accept a
    // coincidental constraint violation and quietly stop testing RLS.
    const code = await asWorkspace(northwind, async (tx) => {
      const [type] = (await tx
        .execute(sql`select id from item_types limit 1`)
        .then((r) => [...r])) as Array<{ id: string }>;

      try {
        await tx.execute(sql`
          insert into items (workspace_id, item_type_id, title, path, position)
          values (${partners}, ${type?.id ?? null}, 'smuggled', 'aaaaaaaa_0000_4000_8000_000000000000', 'a0')
        `);
        return null;
      } catch (e) {
        return sqlStateOf(e);
      }
    }).catch((e: unknown) => sqlStateOf(e));

    expect(code, 'insert with a foreign workspace_id was not blocked by RLS').toBe('42501');
  });

  it('cannot update a row belonging to the other workspace', async () => {
    const [partnerItem] = await ownerClient<Array<{ id: string; title: string }>>`
      select id, title from items where workspace_id = ${partners} limit 1
    `;

    const updated = await asWorkspace(northwind, async (tx) => {
      const result = await tx.execute(sql`
        update items set title = 'overwritten' where id = ${partnerItem?.id ?? ''} returning id
      `);
      return [...result];
    });
    expect(updated).toEqual([]);

    const [after] = await ownerClient<Array<{ title: string }>>`
      select title from items where id = ${partnerItem?.id ?? ''}
    `;
    expect(after?.title).toBe(partnerItem?.title);
  });

  it('cannot delete a row belonging to the other workspace', async () => {
    const before = await ownerClient<Array<{ n: number }>>`
      select count(*)::int as n from items where workspace_id = ${partners}
    `;

    await asWorkspace(northwind, async (tx) => {
      await tx.execute(sql`delete from items where workspace_id = ${partners}`);
    });

    const after = await ownerClient<Array<{ n: number }>>`
      select count(*)::int as n from items where workspace_id = ${partners}
    `;
    expect(after[0]?.n).toBe(before[0]?.n);
  });
});
