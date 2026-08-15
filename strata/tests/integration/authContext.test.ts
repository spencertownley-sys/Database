/**
 * Auth against RLS.
 *
 * These exist because of a real bug: `workspace_members` is a tenant table, so
 * the membership check ran with no workspace pinned, RLS correctly returned
 * zero rows, and a legitimate workspace owner was told they had no access. The
 * failure mode is nasty — nothing errors, nothing logs, the app just denies
 * everyone — and it is invisible to any test that talks to the database as a
 * privileged role.
 *
 * The same shape applies to API key resolution, except there it cannot be
 * fixed by pinning context first: the key is how the workspace is discovered.
 * That path goes through a SECURITY DEFINER function, and the tests below
 * check both that it works and that it stays narrow.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { appDb, closeTestDb, ownerClient, workspaceIdBySlug } from './helpers/db';

let northwind: string;
let partners: string;

beforeAll(async () => {
  northwind = await workspaceIdBySlug('northwind');
  partners = await workspaceIdBySlug('northwind-partners');
});

afterAll(async () => {
  await closeTestDb();
});

/** Runs as the app role with no workspace pinned, like the auth path does. */
async function unpinned<T>(fn: (tx: Parameters<Parameters<typeof appDb.transaction>[0]>[0]) => Promise<T>): Promise<T> {
  return appDb.transaction(fn);
}

describe('membership lookup', () => {
  it('needs workspace context — the bug this suite exists for', async () => {
    // Documents the trap rather than the fix: reading a tenant table with no
    // context is silently empty, which is why the lookup must pin first.
    const unscoped = await unpinned(async (tx) => {
      const result = await tx.execute(
        sql`select id from workspace_members where workspace_id = ${northwind}::uuid`,
      );
      return [...result];
    });
    expect(unscoped).toEqual([]);
  });

  it('finds the owner once the workspace is pinned', async () => {
    const scoped = await appDb.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.workspace_id', ${northwind}, true)`);
      const result = await tx.execute(
        sql`select role, status from workspace_members where workspace_id = ${northwind}::uuid and role = 'owner'`,
      );
      return [...result] as Array<{ role: string; status: string }>;
    });

    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped[0]?.status).toBe('active');
  });
});

describe('app_resolve_api_key', () => {
  const secret = 'sk_live_test_fixture_key';
  // Matches hashApiKey() with the test pepper; computed inline so the test
  // does not depend on the app's env being loaded the same way.
  let hashed: string;
  let keyId: string;

  beforeAll(async () => {
    const { createHash } = await import('node:crypto');
    hashed = createHash('sha256')
      .update(`${process.env.API_KEY_PEPPER ?? 'dev-only-pepper-change-me'}${secret}`, 'utf8')
      .digest('hex');

    const [member] = await ownerClient<Array<{ id: string }>>`
      select id from workspace_members where workspace_id = ${northwind} and role = 'owner' limit 1
    `;

    const [row] = await ownerClient<Array<{ id: string }>>`
      insert into api_keys (workspace_id, member_id, name, prefix, hashed_key, scopes)
      values (${northwind}, ${member?.id ?? null}, 'test fixture', 'sk_live_test', ${hashed}, ARRAY['items:read','items:write'])
      on conflict (hashed_key) do update set name = excluded.name
      returning id
    `;
    keyId = row?.id ?? '';
  });

  afterAll(async () => {
    await ownerClient`delete from api_keys where id = ${keyId}`;
  });

  it('resolves a valid key with no workspace context pinned', async () => {
    const rows = await unpinned(async (tx) => {
      const result = await tx.execute(sql`select * from app_resolve_api_key(${hashed})`);
      return [...result] as Array<{ workspace_id: string; member_role: string }>;
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.workspace_id).toBe(northwind);
    expect(rows[0]?.member_role).toBe('owner');
  });

  it('returns nothing for an unknown hash', async () => {
    const rows = await unpinned(async (tx) => {
      const result = await tx.execute(sql`select * from app_resolve_api_key('not-a-real-hash')`);
      return [...result];
    });
    expect(rows).toEqual([]);
  });

  it('returns nothing for a revoked key', async () => {
    await ownerClient`update api_keys set revoked_at = now() where id = ${keyId}`;
    const rows = await unpinned(async (tx) => {
      const result = await tx.execute(sql`select * from app_resolve_api_key(${hashed})`);
      return [...result];
    });
    expect(rows).toEqual([]);
    await ownerClient`update api_keys set revoked_at = null where id = ${keyId}`;
  });

  it('does not widen access to the tables it reads', async () => {
    // The function is a keyhole, not a door: having called it must not make
    // `api_keys` or `workspace_members` readable in the surrounding session.
    const leaked = await unpinned(async (tx) => {
      await tx.execute(sql`select * from app_resolve_api_key(${hashed})`);
      const result = await tx.execute(sql`select id from api_keys`);
      return [...result];
    });
    expect(leaked).toEqual([]);
  });

  it('is pinned to a fixed search_path', async () => {
    // Without this, a caller could shadow `api_keys` in a schema earlier on
    // their own search_path and have the definer-privileged body read it.
    const [fn] = await ownerClient<Array<{ prosecdef: boolean; proconfig: string[] | null }>>`
      select prosecdef, proconfig from pg_proc where proname = 'app_resolve_api_key'
    `;
    expect(fn?.prosecdef).toBe(true);
    expect(fn?.proconfig ?? []).toContain('search_path=public');
  });

  it('cannot be used to reach another workspace', async () => {
    const rows = await unpinned(async (tx) => {
      const result = await tx.execute(sql`select * from app_resolve_api_key(${hashed})`);
      return [...result] as Array<{ workspace_id: string }>;
    });
    expect(rows[0]?.workspace_id).not.toBe(partners);
  });
});
