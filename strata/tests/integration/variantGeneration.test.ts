/**
 * Variant generation (Step 10) — guided generation as one change set.
 *
 * The invariants: generation previews before it writes, the model flip rides
 * the same change set as the created variants (so undo removes both), existing
 * coordinates are skipped rather than duplicated, and every guard —
 * NOT_VARIANT_ENABLED, INVALID_VARIANT_AXIS, the work-hierarchy constraint —
 * refuses with its named error instead of half-working.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { asWorkspace, closeTestDb, ownerClient, workspaceIdBySlug, type AppTx } from './helpers/db';
import { snapshotWorkspace } from './helpers/workspaceSnapshot';
import { planVariantGeneration } from '@/server/services/items.service';
import {
  commitChangeSet,
  previewChangeSet,
  undoChangeSet,
  type ChangeContext,
} from '@/server/services/changeSets.service';
import type { Actor } from '@/server/services/permissions.service';
import { items } from '@/server/db/schema/items';
import { itemTypes } from '@/server/db/schema/itemTypes';

let workspaceId: string;
let actor: Actor;
let campaignTypeId: string;
let productTypeId: string;

beforeAll(async () => {
  workspaceId = await workspaceIdBySlug('northwind');

  const [member] = await ownerClient<Array<{ id: string; user_id: string }>>`
    select id, user_id from workspace_members
    where workspace_id = ${workspaceId} and role = 'owner' limit 1
  `;
  if (!member) throw new Error('Seed missing an owner member. Run `npm run db:seed`.');
  actor = { userId: member.user_id, workspaceId, memberId: member.id, role: 'owner' };

  const types = await asWorkspace(workspaceId, (tx) =>
    tx
      .select({ id: itemTypes.id, key: itemTypes.key, variantAxes: itemTypes.variantAxes })
      .from(itemTypes)
      .where(eq(itemTypes.workspaceId, workspaceId)),
  );
  const campaign = types.find((t) => t.key === 'campaign');
  const product = types.find((t) => t.variantAxes.length === 2);
  if (!campaign || !product) throw new Error('Seed missing campaign/product types.');
  campaignTypeId = campaign.id;
  productTypeId = product.id;
});

afterAll(async () => {
  await closeTestDb();
});

function ctx(): ChangeContext {
  return { workspaceId, actor, source: 'user' };
}

async function createModel(tx: AppTx, title: string): Promise<string> {
  const { changeSet } = await previewChangeSet(tx, ctx(), {
    operation: 'create',
    itemTypeId: campaignTypeId,
    target: { kind: 'new', drafts: [{ title }] },
  });
  await commitChangeSet(tx, ctx(), changeSet.id);
  const [row] = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.workspaceId, workspaceId), eq(items.title, title)))
    .limit(1);
  if (!row) throw new Error('model was not created');
  return row.id;
}

describe('generation as one change set', () => {
  it('creates the variants, flips the model, and undoes both together', async () => {
    const modelId = await asWorkspace(workspaceId, (tx) =>
      createModel(tx, 'Gen Test Campaign'),
    );

    const before = await asWorkspace(workspaceId, (tx) => snapshotWorkspace(tx, workspaceId));

    const changeSetId = await asWorkspace(workspaceId, async (tx) => {
      const plan = await planVariantGeneration(tx, workspaceId, modelId, {
        region: ['emea', 'apac', 'latam'],
      });
      expect(plan.adding).toBe(3);
      expect(plan.skippedExisting).toBe(0);

      const { changeSet } = await previewChangeSet(tx, ctx(), {
        operation: 'create',
        itemTypeId: plan.itemTypeId,
        target: { kind: 'new', drafts: plan.drafts },
      });
      // 3 creates + 1 model flip ride together.
      expect(changeSet.itemCount).toBe(4);
      await commitChangeSet(tx, ctx(), changeSet.id);
      return changeSet.id;
    });

    const { model, variants } = await asWorkspace(workspaceId, async (tx) => {
      const [modelRow] = await tx
        .select()
        .from(items)
        .where(and(eq(items.workspaceId, workspaceId), eq(items.id, modelId)))
        .limit(1);
      const variantRows = await tx
        .select()
        .from(items)
        .where(
          and(
            eq(items.workspaceId, workspaceId),
            eq(items.variantParentId, modelId),
            isNull(items.archivedAt),
          ),
        );
      return { model: modelRow, variants: variantRows };
    });

    expect(model?.isVariantModel).toBe(true);
    expect(variants).toHaveLength(3);

    const emea = variants.find((v) => v.variantAxisValues?.region === 'emea');
    expect(emea?.title).toBe('Gen Test Campaign (EMEA)');
    // The axis value is the variant's own value, and the model's shared/default
    // values flow into effective_values (status defaults to draft).
    expect(emea?.values.region).toBe('emea');
    expect(emea?.effectiveValues.region).toBe('emea');
    expect(emea?.effectiveValues.status).toBe('draft');

    // Undo removes the variants outright and restores the model's flag.
    await asWorkspace(workspaceId, (tx) => undoChangeSet(tx, ctx(), changeSetId));
    const after = await asWorkspace(workspaceId, (tx) => snapshotWorkspace(tx, workspaceId));
    expect(after).toStrictEqual(before);

    // Fixture cleanup: the campaign model itself.
    await ownerClient`delete from items where id = ${modelId}`;
  });

  it('skips coordinates that already exist instead of duplicating them', async () => {
    // Seeded products already carry variants; pick one and re-request a grid
    // that overlaps its existing coordinates.
    const seeded = await asWorkspace(workspaceId, (tx) =>
      tx
        .select({ id: items.id })
        .from(items)
        .where(
          and(
            eq(items.workspaceId, workspaceId),
            eq(items.itemTypeId, productTypeId),
            eq(items.isVariantModel, true),
          ),
        )
        .limit(1),
    );
    const modelId = (seeded[0] as { id: string }).id;

    const existing = await asWorkspace(workspaceId, (tx) =>
      tx
        .select({ variantAxisValues: items.variantAxisValues })
        .from(items)
        .where(
          and(
            eq(items.workspaceId, workspaceId),
            eq(items.variantParentId, modelId),
            isNull(items.archivedAt),
          ),
        ),
    );
    const first = existing[0]?.variantAxisValues;
    if (!first) throw new Error('Seeded model has no variants.');

    const plan = await asWorkspace(workspaceId, (tx) =>
      planVariantGeneration(tx, workspaceId, modelId, {
        region: [first.region as string, 'latam'],
        size: [first.size as string],
      }),
    );

    // first.region×first.size exists; latam×first.size may or may not, so the
    // invariant under test is exact accounting, not a fixed count.
    expect(plan.skippedExisting).toBeGreaterThanOrEqual(1);
    expect(plan.adding + plan.skippedExisting).toBe(2);
  });
});

describe('guards', () => {
  it('refuses a type with no axes with NOT_VARIANT_ENABLED', async () => {
    const tasks = await asWorkspace(workspaceId, (tx) =>
      tx
        .select({ id: items.id })
        .from(items)
        .innerJoin(itemTypes, eq(itemTypes.id, items.itemTypeId))
        .where(
          and(
            eq(items.workspaceId, workspaceId),
            eq(itemTypes.key, 'task'),
            isNull(items.archivedAt),
          ),
        )
        .limit(1),
    );
    const task = tasks[0] as { id: string };

    await expect(
      asWorkspace(workspaceId, (tx) =>
        planVariantGeneration(tx, workspaceId, task.id, { region: ['emea'] }),
      ),
    ).rejects.toMatchObject({ code: 'NOT_VARIANT_ENABLED' });
  });

  it('refuses an unknown axis option with INVALID_VARIANT_AXIS', async () => {
    const modelId = await asWorkspace(workspaceId, (tx) => createModel(tx, 'Bad Axis Campaign'));
    await expect(
      asWorkspace(workspaceId, (tx) =>
        planVariantGeneration(tx, workspaceId, modelId, { region: ['narnia'] }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_VARIANT_AXIS' });
    await ownerClient`delete from items where id = ${modelId}`;
  });

  it('refuses a model nested in the work hierarchy with VARIANT_CONSTRAINT', async () => {
    const parentId = await asWorkspace(workspaceId, (tx) => createModel(tx, 'Parent Campaign X'));
    const childId = await asWorkspace(workspaceId, async (tx) => {
      const { changeSet } = await previewChangeSet(tx, ctx(), {
        operation: 'create',
        itemTypeId: campaignTypeId,
        target: { kind: 'new', drafts: [{ title: 'Nested Campaign X', parentId }] },
      });
      await commitChangeSet(tx, ctx(), changeSet.id);
      const [row] = await tx
        .select({ id: items.id })
        .from(items)
        .where(and(eq(items.workspaceId, workspaceId), eq(items.title, 'Nested Campaign X')))
        .limit(1);
      if (!row) throw new Error('nested campaign was not created');
      return row.id;
    });

    await expect(
      asWorkspace(workspaceId, (tx) =>
        planVariantGeneration(tx, workspaceId, childId, { region: ['emea'] }),
      ),
    ).rejects.toMatchObject({ code: 'VARIANT_CONSTRAINT' });

    await ownerClient`delete from items where id in (${childId}, ${parentId})`;
  });
});
