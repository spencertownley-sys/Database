/**
 * Projection consistency.
 *
 * `item_field_index` is derived: every row in it must be reconstructible from
 * `items.effective_values` plus the field definitions, and nothing may exist in
 * it that those two do not imply.
 *
 * This is the invariant the nightly `projectionAudit` job samples 1% of in
 * production. It is worth testing exhaustively here because the failure is
 * invisible in the UI: a stale index row does not throw, it just quietly makes
 * a filter return the wrong set of items — which in a work tool reads as work
 * having disappeared.
 *
 * The test asserts in both directions. Only checking that every expected row
 * exists would miss orphans, which is precisely the bug a type change or a
 * cleared field introduces.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { asWorkspace, closeTestDb, workspaceIdBySlug } from './helpers/db';
import { canonical } from './helpers/workspaceSnapshot';
import { fields as fieldsTable } from '@/server/db/schema/itemTypes';
import { items } from '@/server/db/schema/items';
import { toIndexValue } from '@/server/validation/fieldTypes';
import {
  commitChangeSet,
  previewChangeSet,
  type ChangeContext,
} from '@/server/services/changeSets.service';
import type { Actor } from '@/server/services/permissions.service';
import { ownerClient } from './helpers/db';

let workspaceId: string;
let actor: Actor;

beforeAll(async () => {
  workspaceId = await workspaceIdBySlug('northwind');
  const [member] = await ownerClient<Array<{ id: string; user_id: string }>>`
    select id, user_id from workspace_members
    where workspace_id = ${workspaceId} and role = 'owner' limit 1
  `;
  if (!member) throw new Error('Seed missing an owner member.');
  actor = { userId: member.user_id, workspaceId, memberId: member.id, role: 'owner' };
});

afterAll(async () => {
  await closeTestDb();
});

interface Divergence {
  itemId: string;
  fieldId: string;
  kind: 'missing' | 'orphaned' | 'mismatched';
  expected?: unknown;
  actual?: unknown;
}

/** Rebuilds the whole index from source and diffs it against what is stored. */
async function findDivergences(): Promise<Divergence[]> {
  return asWorkspace(workspaceId, async (tx) => {
    const liveFields = await tx
      .select()
      .from(fieldsTable)
      .where(and(eq(fieldsTable.workspaceId, workspaceId), isNull(fieldsTable.deletedAt)));

    const indexedByType = new Map<string, typeof liveFields>();
    for (const field of liveFields) {
      if (!field.isIndexed) continue;
      const list = indexedByType.get(field.itemTypeId);
      if (list) list.push(field);
      else indexedByType.set(field.itemTypeId, [field]);
    }

    const rows = await tx
      .select({
        id: items.id,
        itemTypeId: items.itemTypeId,
        effectiveValues: items.effectiveValues,
      })
      .from(items)
      .where(and(eq(items.workspaceId, workspaceId), isNull(items.archivedAt)));

    // What the index *should* contain, keyed by (item, field).
    const expected = new Map<string, string>();
    for (const item of rows) {
      for (const field of indexedByType.get(item.itemTypeId) ?? []) {
        const value = item.effectiveValues[field.key];
        if (value === null || value === undefined) continue;
        const projected = toIndexValue(field.type, value, field.config);
        if (projected.column === null) continue;
        expected.set(`${item.id}|${field.id}`, canonical(normalise(projected)));
      }
    }

    const storedRows = await tx.execute(sql`
      select item_id, field_id, value_text, value_number::float8 as value_number,
             value_date, value_bool, value_uuid, value_text_array
      from item_field_index
      where workspace_id = ${workspaceId}
    `);

    const divergences: Divergence[] = [];
    const seen = new Set<string>();

    for (const raw of [...storedRows] as Array<Record<string, unknown>>) {
      const key = `${String(raw.item_id)}|${String(raw.field_id)}`;
      seen.add(key);
      const want = expected.get(key);
      if (want === undefined) {
        divergences.push({
          itemId: String(raw.item_id),
          fieldId: String(raw.field_id),
          kind: 'orphaned',
          actual: raw,
        });
        continue;
      }
      const got = canonical(
        normalise({
          valueText: raw.value_text as string | null,
          valueNumber: raw.value_number === null ? null : Number(raw.value_number),
          valueDate: raw.value_date === null ? null : new Date(String(raw.value_date)),
          valueBool: raw.value_bool as boolean | null,
          valueUuid: raw.value_uuid as string | null,
          valueTextArray: raw.value_text_array as string[] | null,
        }),
      );
      if (got !== want) {
        divergences.push({
          itemId: String(raw.item_id),
          fieldId: String(raw.field_id),
          kind: 'mismatched',
          expected: want,
          actual: got,
        });
      }
    }

    for (const key of expected.keys()) {
      if (seen.has(key)) continue;
      const [itemId = '', fieldId = ''] = key.split('|');
      divergences.push({ itemId, fieldId, kind: 'missing', expected: expected.get(key) });
    }

    return divergences;
  });
}

function normalise(value: {
  valueText?: string | null;
  valueNumber?: number | null;
  valueDate?: Date | null;
  valueBool?: boolean | null;
  valueUuid?: string | null;
  valueTextArray?: string[] | null;
}): Record<string, unknown> {
  return {
    text: value.valueText ?? null,
    number: value.valueNumber ?? null,
    date: value.valueDate ? value.valueDate.toISOString() : null,
    bool: value.valueBool ?? null,
    uuid: value.valueUuid ?? null,
    array: value.valueTextArray ?? null,
  };
}

function ctx(): ChangeContext {
  return { workspaceId, actor, source: 'user' };
}

async function someItemIds(limit: number): Promise<string[]> {
  return asWorkspace(workspaceId, async (tx) => {
    const rows = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.workspaceId, workspaceId), isNull(items.archivedAt)))
      .orderBy(items.id)
      .limit(limit);
    return rows.map((r) => r.id);
  });
}

async function apply(input: Parameters<typeof previewChangeSet>[2]): Promise<void> {
  await asWorkspace(workspaceId, async (tx) => {
    const { changeSet } = await previewChangeSet(tx, ctx(), input);
    await commitChangeSet(tx, ctx(), changeSet.id);
  });
}

describe('item_field_index stays derivable from effective_values', () => {
  it('agrees with the seed', async () => {
    expect(await findDivergences()).toEqual([]);
  });

  it('stays consistent after setting values', async () => {
    const ids = await someItemIds(20);
    await apply({
      operation: 'set_field',
      target: { kind: 'ids', itemIds: ids },
      patch: { values: { status: 'in_progress' } },
    });
    expect(await findDivergences()).toEqual([]);
  });

  it('stays consistent after clearing values — no orphaned rows', async () => {
    const ids = await someItemIds(20);
    await apply({
      operation: 'clear_field',
      target: { kind: 'ids', itemIds: ids },
      patch: { fieldKeys: ['status', 'priority', 'due_date'] },
    });
    const divergences = await findDivergences();
    // The specific failure this catches: clearing a value leaves its index row
    // behind, so "status is In progress" keeps returning an item that no
    // longer has a status at all.
    expect(divergences.filter((d) => d.kind === 'orphaned')).toEqual([]);
    expect(divergences).toEqual([]);
  });

  it('stays consistent after deleting and restoring items', async () => {
    const ids = await someItemIds(5);
    const changeSetId = await asWorkspace(workspaceId, async (tx) => {
      const { changeSet } = await previewChangeSet(tx, ctx(), {
        operation: 'delete',
        target: { kind: 'ids', itemIds: ids },
      });
      await commitChangeSet(tx, ctx(), changeSet.id);
      return changeSet.id;
    });

    expect(await findDivergences(), 'index rows survived a delete').toEqual([]);

    const { undoChangeSet } = await import('@/server/services/changeSets.service');
    await asWorkspace(workspaceId, (tx) => undoChangeSet(tx, ctx(), changeSetId));

    expect(await findDivergences(), 'index rows were not rebuilt on restore').toEqual([]);
  });

  it('stays consistent after a variant model write propagates', async () => {
    const modelId = await asWorkspace(workspaceId, async (tx) => {
      const rows = await tx
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.workspaceId, workspaceId),
            eq(items.isVariantModel, true),
            isNull(items.archivedAt),
          ),
        )
        .limit(1);
      return rows[0]?.id;
    });
    if (!modelId) throw new Error('Seed missing a variant model.');

    await apply({
      operation: 'set_field',
      target: { kind: 'ids', itemIds: [modelId] },
      patch: { values: { launch_date: '2027-01-15', material: 'Organic canvas' } },
    });

    expect(await findDivergences()).toEqual([]);
  });
});
