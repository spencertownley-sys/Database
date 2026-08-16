/**
 * §6.1 server-side query budgets on the 100k fixture — acceptance criteria,
 * not aspirations (Step 15). Each budgeted query runs a few times and asserts
 * the *median*, so one cold cache or CI hiccup does not flake the build while
 * a real regression still fails it.
 *
 * The EXPLAIN gate is the sharp one: any plan that seq-scans `items` fails,
 * whatever the wall clock said — today's warm cache hides tomorrow's O(n).
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { asWorkspace, closeTestDb } from '~/tests/integration/helpers/db';
import { ensurePerfFixture, PERF_SUBTREE_ITEMS, type PerfFixture } from './fixture';
import { explainSearch, searchProvider } from '@/server/search/PostgresSearchProvider';
import { fields as fieldsTable, type Field } from '@/server/db/schema/itemTypes';
import type { FilterGroup } from '@/types/filters';

let fixture: PerfFixture;
let fields: Field[];

beforeAll(async () => {
  fixture = await ensurePerfFixture();
  fields = await asWorkspace(fixture.workspaceId, (tx) =>
    tx
      .select()
      .from(fieldsTable)
      .where(and(eq(fieldsTable.workspaceId, fixture.workspaceId), isNull(fieldsTable.deletedAt))),
  );
}, 600_000);

afterAll(async () => {
  await closeTestDb();
});

/**
 * 8 clauses — the §6.1 scale point for the filtered page. Like a real ops
 * query ("this SKU family, active, due this quarter…"), one clause is
 * genuinely selective (f8 eq → ~1% of the workspace); the rest narrow it
 * further. The all-broad variant below has its own looser guard.
 */
const EIGHT_CLAUSES: FilterGroup = {
  op: 'and',
  children: [
    // 40, not 42: f8 derives from g mod 100 and f1 from g mod 5, which share
    // a factor — g≡42 (mod 100) never lands in f1's opt_a/opt_b, and a
    // zero-survivor filter would "pass" any budget while measuring nothing.
    { field: 'f8', operator: 'eq', value: 'text value 40' },
    { field: 'f1', operator: 'in', value: ['opt_a', 'opt_b'] },
    { field: 'f2', operator: 'neq', value: 'opt_c' },
    { field: 'f3', operator: 'gte', value: 100 },
    { field: 'f5', operator: 'on_or_after', value: '2026-02-01' },
    { field: 'f7', operator: 'is_true' },
    {
      op: 'or',
      children: [
        { field: 'f4', operator: 'lt', value: 250 },
        { field: 'f6', operator: 'on_or_after', value: '2026-07-01' },
      ],
    },
  ],
};

/**
 * Every clause individually matches 20–60% of the workspace and ~16k items
 * survive all of them — closer to "browse most of the workspace" than to a
 * filter. Not the §6.1 scale point, but a guard against the O(n·clauses)
 * regressions that a selective filter would hide.
 */
const BROAD_CLAUSES: FilterGroup = {
  op: 'and',
  children: [
    { field: 'f1', operator: 'in', value: ['opt_a', 'opt_b'] },
    { field: 'f2', operator: 'neq', value: 'opt_c' },
    { field: 'f3', operator: 'gte', value: 100 },
    { field: 'f5', operator: 'on_or_after', value: '2026-02-01' },
    { field: 'f7', operator: 'is_true' },
  ],
};

async function median(runs: number, fn: () => Promise<void>): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)] as number;
}

describe('EXPLAIN gate — no seq scan on items, ever', () => {
  // Text search is deliberately absent: `ILIKE` is not leakproof, and under
  // row-level security Postgres refuses non-leakproof operators as index
  // quals — the trigram GIN is legally unusable, so the honest text-search
  // gate is its runtime budget below, not a plan shape it cannot have. The
  // seq scan it gets is bounded by the workspace's own rows (AD-5: the
  // explicit workspace_id equality IS leakproof and does drive an index in
  // multi-tenant tables).
  const scenarios: Array<[string, Parameters<typeof explainSearch>[3]]> = [
    ['filtered + sorted page', {
      itemTypeId: undefined,
      filter: EIGHT_CLAUSES,
      sort: [{ field: 'f3', direction: 'desc' }],
      limit: 100,
    }],
    ['subtree filter', { underItemId: '', limit: 100 }],
    ['keyset page by title', { sort: [{ field: '$title', direction: 'asc' }], limit: 100 }],
  ];

  for (const [name, query] of scenarios) {
    it(`${name} plan has no Seq Scan on items`, async () => {
      const q = { ...query };
      if ('underItemId' in q && q.underItemId === '') q.underItemId = fixture.chainRootId;

      const plan = await asWorkspace(fixture.workspaceId, (tx) =>
        explainSearch(tx, fixture.workspaceId, fields, { ...q, itemTypeId: fixture.itemTypeId }),
      );
      const rendered = JSON.stringify(plan);
      const seqScansItems = /"Node Type":\s*"Seq Scan"[^}]*"Relation Name":\s*"items"/.test(
        rendered,
      );
      expect(seqScansItems, `plan seq-scans items:\n${rendered.slice(0, 1500)}`).toBe(false);
    });
  }
});

describe('§6.1 budgets (server-side medians)', () => {
  it('filtered + sorted page of 100 under 300ms at 8 clauses', async () => {
    const ms = await median(5, async () => {
      const page = await asWorkspace(fixture.workspaceId, (tx) =>
        searchProvider.search(tx, fixture.workspaceId, fields, {
          itemTypeId: fixture.itemTypeId,
          filter: EIGHT_CLAUSES,
          sort: [{ field: 'f3', direction: 'desc' }],
          limit: 100,
        }),
      );
      expect(page.items.length).toBeGreaterThan(0);
    });
    expect(ms, `median ${ms.toFixed(0)}ms`).toBeLessThan(300);
  });

  it('an all-broad filter (16k survivors) stays bounded', async () => {
    const ms = await median(3, async () => {
      const page = await asWorkspace(fixture.workspaceId, (tx) =>
        searchProvider.search(tx, fixture.workspaceId, fields, {
          itemTypeId: fixture.itemTypeId,
          filter: BROAD_CLAUSES,
          sort: [{ field: 'f3', direction: 'desc' }],
          limit: 100,
        }),
      );
      expect(page.items.length).toBe(100);
    });
    expect(ms, `median ${ms.toFixed(0)}ms`).toBeLessThan(1000);
  });

  it('text search under 400ms', async () => {
    const ms = await median(5, async () => {
      const page = await asWorkspace(fixture.workspaceId, (tx) =>
        searchProvider.search(tx, fixture.workspaceId, fields, {
          itemTypeId: fixture.itemTypeId,
          search: 'text value 42',
          limit: 100,
        }),
      );
      expect(page.items.length).toBeGreaterThan(0);
    });
    expect(ms, `median ${ms.toFixed(0)}ms`).toBeLessThan(400);
  });

  it('depth-8 subtree over ~50k items under 300ms', async () => {
    const ms = await median(5, async () => {
      const page = await asWorkspace(fixture.workspaceId, (tx) =>
        searchProvider.search(tx, fixture.workspaceId, fields, {
          itemTypeId: fixture.itemTypeId,
          underItemId: fixture.chainRootId,
          sort: [{ field: '$title', direction: 'asc' }],
          limit: 100,
        }),
      );
      expect(page.items.length).toBe(100);
    });
    expect(ms, `median ${ms.toFixed(0)}ms`).toBeLessThan(300);
  });

  it('the subtree really is the §6.1 scale point', async () => {
    const total = await asWorkspace(fixture.workspaceId, async (tx) => {
      const rows = await tx.execute(sql`
        select count(*)::int as n from items
        where workspace_id = ${fixture.workspaceId}::uuid
          and path <@ (select path from items where id = ${fixture.chainRootId}::uuid)
      `);
      return ([...rows][0] as { n: number }).n;
    });
    expect(total).toBe(PERF_SUBTREE_ITEMS + 7); // chain nodes 2..8 + tail's 50k + root itself
  });
});
