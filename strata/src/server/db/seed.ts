/**
 * Development and test fixture.
 *
 * Two workspaces with *deliberately overlapping* data — the same client names,
 * the same project titles, the same field keys, users who belong to both. A
 * seed with obviously distinct data ("Workspace A Item 1") makes a leak look
 * like a normal result, so `tests/integration/tenantIsolation.test.ts` would
 * pass against a broken policy. Overlap is the point.
 *
 * This file writes to `items` directly rather than through change sets. That
 * is the one sanctioned exception in the codebase: a fixture is not a user
 * action, has no actor, and should not appear in anybody's undo history or
 * activity feed. Everything under `src/server/services/` still goes through
 * `changeSets.service.ts`.
 *
 * Deterministic by construction — a seeded PRNG mints every id — so tests can
 * hard-code fixture ids and a diff between two seed runs is empty.
 */

import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

import { schema } from './schema';
import {
  guestScopes,
  users,
  workspaceMembers,
  workspaces,
  type MemberRole,
} from './schema/workspaces';
import { fieldGroups, fields as fieldsTable, itemTypes } from './schema/itemTypes';
import { itemFieldIndex, items } from './schema/items';
import { itemTreeNodes, treeNodes, trees } from './schema/trees';
import { views } from './schema/views';
import { computeCompleteness } from '../services/completeness.service';
import { ALWAYS_INDEXED_TYPES } from '../services/fields.service';
import { computeEffectiveValues, ownEffectiveValues } from '../services/variants.service';
import { buildSearchText } from '../search/projection';
import { toIndexValue } from '../validation/fieldTypes';
import { childPath } from '../lib/ltree';
import { appendKeys } from '../lib/fractionalIndex';
import { ITEM_TYPE_PRESETS, PRESETS_BY_KEY, type ItemTypePreset } from '@/components/type-builder/presets';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

// ---------------------------------------------------------------------------
// deterministic ids
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x5747a7a);

function uuid(): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 32; i += 1) {
    if (i === 12) out += '4';
    else if (i === 16) out += hex[(Math.floor(rand() * 16) & 0x3) | 0x8];
    else out += hex[Math.floor(rand() * 16)];
  }
  return `${out.slice(0, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}-${out.slice(16, 20)}-${out.slice(20)}`;
}

function pick<T>(list: readonly T[]): T {
  const v = list[Math.floor(rand() * list.length)];
  if (v === undefined) throw new Error('pick() from an empty list');
  return v;
}

function maybe(probability: number): boolean {
  return rand() < probability;
}

function isoDate(offsetDays: number): string {
  const base = new Date(Date.UTC(2026, 0, 15));
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// fixture content — the same names in both workspaces, on purpose
// ---------------------------------------------------------------------------

const CLIENT_NAMES = ['Acme Corp', 'Globex', 'Initech', 'Umbrella Retail', 'Soylent Foods'];

const PROJECT_TITLES = [
  'Website replatform',
  'Q1 brand refresh',
  'Packaging system',
  'Loyalty programme launch',
  'Annual report',
  'Trade show stand',
];

const TASK_TITLES = [
  'Kickoff workshop',
  'Stakeholder interviews',
  'Content audit',
  'Wireframes',
  'Design system tokens',
  'Copy deck v1',
  'Legal review',
  'Photography shoot',
  'Build handoff',
  'QA pass',
  'Accessibility audit',
  'Launch checklist',
];

const CAMPAIGN_TITLES = [
  'Spring product push',
  'Always-on demand gen',
  'Retail partner co-marketing',
  'Loyalty re-engagement',
  'Conference follow-up',
];

const PRODUCT_TITLES = ['Field Jacket', 'Trail Runner', 'Merino Base Layer'];

// ---------------------------------------------------------------------------

const url =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/strata';

const sqlClient = postgres(url, { max: 1, onnotice: () => {} });
const db = drizzle(sqlClient, { schema });

interface SeededSchema {
  typeId: string;
  preset: ItemTypePreset;
  fields: Array<{
    id: string;
    key: string;
    type: (typeof ITEM_TYPE_PRESETS)[number]['fields'][number]['type'];
    config: Record<string, unknown>;
    requiredForCompleteness: boolean;
    inheritance: 'shared' | 'variant';
    isIndexed: boolean;
    isSearchable: boolean;
  }>;
}

interface PendingItem {
  id: string;
  workspaceId: string;
  itemTypeId: string;
  title: string;
  parentId: string | null;
  path: string;
  depth: number;
  position: string;
  isVariantModel: boolean;
  variantParentId: string | null;
  variantAxisValues: Record<string, string> | null;
  values: Record<string, unknown>;
  effectiveValues: Record<string, unknown>;
  completenessPct: number;
  missingRequired: string[];
  searchText: string;
  assigneeId: string | null;
  createdBy: string;
  updatedBy: string;
}

async function truncateAll(): Promise<void> {
  const tables = [
    'item_field_index',
    'item_tree_nodes',
    'change_entries',
    'change_sets',
    'notifications',
    'webhook_deliveries',
    'webhooks',
    'api_keys',
    'export_jobs',
    'import_jobs',
    'import_profiles',
    'views',
    'items',
    'tree_nodes',
    'trees',
    'fields',
    'field_groups',
    'item_types',
    'guest_scopes',
    'workspace_members',
    'workspaces',
    'users',
  ];
  await db.execute(sql.raw(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} CASCADE`));
}

async function seedUsers(): Promise<Map<string, string>> {
  const people: Array<[email: string, name: string]> = [
    ['alice@northwind.test', 'Alice Okonkwo'],
    ['bob@northwind.test', 'Bob Lindqvist'],
    ['carol@northwind.test', 'Carol Mensah'],
    ['dana@client.test', 'Dana Whitfield'],
    ['erin@partners.test', 'Erin Vasquez'],
    ['frank@partners.test', 'Frank Osei'],
    // Belongs to both workspaces — the case where a naive membership check
    // that forgets `workspace_id` silently succeeds.
    ['morgan@shared.test', 'Morgan Reyes'],
  ];

  const rows = people.map(([email, name]) => ({ id: uuid(), email, name }));
  await db.insert(users).values(rows);
  return new Map(rows.map((r) => [r.email, r.id]));
}

async function seedItemTypeSchema(
  workspaceId: string,
  presetKey: string,
  actorId: string,
): Promise<SeededSchema> {
  const preset = PRESETS_BY_KEY[presetKey];
  if (!preset) throw new Error(`Unknown preset ${presetKey}`);

  const typeId = uuid();
  await db.insert(itemTypes).values({
    id: typeId,
    workspaceId,
    key: preset.key,
    label: preset.label,
    pluralLabel: preset.pluralLabel,
    description: preset.description,
    icon: preset.icon,
    color: preset.color,
    presetSource: preset.key,
    variantAxes: preset.variantAxes ?? [],
    createdBy: actorId,
  });

  const groupOrder = appendKeys(null, Math.max(preset.groups.length, 1));
  const groupRows = preset.groups.map((g, i) => ({
    id: uuid(),
    workspaceId,
    itemTypeId: typeId,
    key: g.key,
    label: g.label,
    position: groupOrder[i] as string,
    collapsedByDefault: g.collapsedByDefault ?? false,
  }));
  if (groupRows.length) await db.insert(fieldGroups).values(groupRows);
  const groupIdByKey = new Map(groupRows.map((g) => [g.key, g.id]));

  const fieldOrder = appendKeys(null, preset.fields.length);
  const fieldRows = preset.fields.map((f, i) => ({
    id: uuid(),
    workspaceId,
    itemTypeId: typeId,
    fieldGroupId: f.group ? (groupIdByKey.get(f.group) ?? null) : null,
    key: f.key,
    label: f.label,
    type: f.type,
    config: (f.config ?? {}) as Record<string, unknown>,
    helpText: f.helpText ?? null,
    requiredForCompleteness: f.requiredForCompleteness ?? false,
    defaultValue: f.defaultValue ?? null,
    inheritance: f.inheritance ?? ('variant' as const),
    isIndexed: ALWAYS_INDEXED_TYPES.has(f.type) || (f.isIndexed ?? false),
    isSearchable: f.isSearchable ?? false,
    position: fieldOrder[i] as string,
    createdBy: actorId,
  }));
  if (fieldRows.length) {
    await db.insert(fieldsTable).values(fieldRows as never);
  }

  return {
    typeId,
    preset,
    fields: fieldRows.map((f) => ({
      id: f.id,
      key: f.key,
      type: f.type,
      config: f.config,
      requiredForCompleteness: f.requiredForCompleteness,
      inheritance: f.inheritance,
      isIndexed: f.isIndexed,
      isSearchable: f.isSearchable,
    })),
  };
}

/** Fills in the derived columns exactly as a change-set commit would. */
function finalize(
  item: Omit<
    PendingItem,
    'depth' | 'effectiveValues' | 'completenessPct' | 'missingRequired' | 'searchText'
  >,
  schemaDef: SeededSchema,
  modelValues?: Record<string, unknown>,
): PendingItem {
  const fieldDefs = schemaDef.fields.map((f) => ({
    key: f.key,
    type: f.type,
    config: f.config as never,
    requiredForCompleteness: f.requiredForCompleteness,
    inheritance: f.inheritance,
    isSearchable: f.isSearchable,
  }));

  const effectiveValues = modelValues
    ? computeEffectiveValues(modelValues, item.values, fieldDefs, schemaDef.preset.variantAxes ?? [])
        .values
    : ownEffectiveValues(item.values, fieldDefs);

  const completeness = computeCompleteness({
    effectiveValues,
    fields: fieldDefs,
  });

  return {
    ...item,
    depth: item.path.split('.').length - 1,
    effectiveValues,
    completenessPct: completeness.pct,
    missingRequired: completeness.missingRequired,
    searchText: buildSearchText(item.title, effectiveValues, fieldDefs),
  };
}

function projectionRowsFor(pending: PendingItem[], schemas: SeededSchema[]): Array<Record<string, unknown>> {
  const byTypeId = new Map(schemas.map((s) => [s.typeId, s]));
  const rows: Array<Record<string, unknown>> = [];

  for (const item of pending) {
    const schemaDef = byTypeId.get(item.itemTypeId);
    if (!schemaDef) continue;
    for (const field of schemaDef.fields) {
      if (!field.isIndexed) continue;
      const value = item.effectiveValues[field.key];
      if (value === null || value === undefined) continue;
      const projected = toIndexValue(field.type, value, field.config as never);
      if (projected.column === null) continue;
      rows.push({
        workspaceId: item.workspaceId,
        itemId: item.id,
        fieldId: field.id,
        itemTypeId: item.itemTypeId,
        valueText: projected.valueText ?? null,
        valueNumber: projected.valueNumber ?? null,
        valueDate: projected.valueDate ?? null,
        valueBool: projected.valueBool ?? null,
        valueUuid: projected.valueUuid ?? null,
        valueTextArray: projected.valueTextArray ?? null,
      });
    }
  }
  return rows;
}

interface WorkspaceSpec {
  slug: string;
  name: string;
  members: Array<[email: string, role: MemberRole]>;
  guestEmail?: string;
  projectCount: number;
  campaignCount: number;
  withProducts: boolean;
}

async function seedWorkspace(
  spec: WorkspaceSpec,
  userIds: Map<string, string>,
): Promise<{ workspaceId: string; itemCount: number }> {
  const workspaceId = uuid();
  await db.insert(workspaces).values({
    id: workspaceId,
    slug: spec.slug,
    name: spec.name,
    plan: 'team',
  });

  const memberIdByEmail = new Map<string, string>();
  const memberRows = spec.members.map(([email, role]) => {
    const id = uuid();
    memberIdByEmail.set(email, id);
    return {
      id,
      workspaceId,
      userId: userIds.get(email) ?? null,
      role,
      status: 'active' as const,
      acceptedAt: new Date(),
    };
  });
  await db.insert(workspaceMembers).values(memberRows);

  const ownerEmail = spec.members[0]?.[0] as string;
  const ownerId = userIds.get(ownerEmail) as string;
  const memberUserIds = spec.members
    .filter(([, role]) => role !== 'guest')
    .map(([email]) => userIds.get(email) as string);

  // --- schemas -------------------------------------------------------------
  const presetKeys = spec.withProducts
    ? ['client_project', 'task', 'campaign', 'product_variant']
    : ['client_project', 'task', 'campaign'];
  const schemas: SeededSchema[] = [];
  for (const key of presetKeys) {
    schemas.push(await seedItemTypeSchema(workspaceId, key, ownerId));
  }
  const projectSchema = schemas[0] as SeededSchema;
  const taskSchema = schemas[1] as SeededSchema;
  const campaignSchema = schemas[2] as SeededSchema;
  const productSchema = schemas[3];

  // --- category tree -------------------------------------------------------
  const treeId = uuid();
  await db.insert(trees).values({
    id: treeId,
    workspaceId,
    key: 'clients',
    label: 'Clients',
    description: 'Who the work belongs to.',
    isBuiltIn: true,
    icon: 'folder',
  });

  const nodeRows: Array<{
    id: string;
    workspaceId: string;
    treeId: string;
    parentId: string | null;
    path: string;
    position: string;
    label: string;
    itemCount: number;
  }> = [];

  const rootKeys = appendKeys(null, CLIENT_NAMES.length);
  const leafNodeIds: string[] = [];

  CLIENT_NAMES.forEach((clientName, i) => {
    const rootId = uuid();
    const rootPath = childPath(null, rootId);
    nodeRows.push({
      id: rootId,
      workspaceId,
      treeId,
      parentId: null,
      path: rootPath,
      position: rootKeys[i] as string,
      label: clientName,
      itemCount: 0,
    });

    const childNames = ['Brand', 'Digital', 'Retail'];
    const childKeys = appendKeys(null, childNames.length);
    childNames.forEach((childName, j) => {
      const childId = uuid();
      const path = childPath(rootPath, childId);
      nodeRows.push({
        id: childId,
        workspaceId,
        treeId,
        parentId: rootId,
        path,
        position: childKeys[j] as string,
        label: childName,
        itemCount: 0,
      });
      leafNodeIds.push(childId);

      // One level deeper on the first client, so the fixture exercises a
      // depth-4 subtree filter rather than only depth-2.
      if (i === 0 && j === 0) {
        const grandKeys = appendKeys(null, 2);
        ['Identity', 'Guidelines'].forEach((grandName, k) => {
          const grandId = uuid();
          nodeRows.push({
            id: grandId,
            workspaceId,
            treeId,
            parentId: childId,
            path: childPath(path, grandId),
            position: grandKeys[k] as string,
            label: grandName,
            itemCount: 0,
          });
          leafNodeIds.push(grandId);
        });
      }
    });
  });

  await db.insert(treeNodes).values(nodeRows);

  // --- items ---------------------------------------------------------------
  const pending: PendingItem[] = [];
  const memberships: Array<{
    workspaceId: string;
    itemId: string;
    treeNodeId: string;
    treeId: string;
  }> = [];

  const projectOrder = appendKeys(null, spec.projectCount);
  for (let p = 0; p < spec.projectCount; p += 1) {
    const projectId = uuid();
    const clientName = CLIENT_NAMES[p % CLIENT_NAMES.length] as string;
    const title = `${clientName} — ${PROJECT_TITLES[p % PROJECT_TITLES.length]}`;
    const path = childPath(null, projectId);

    const values: Record<string, unknown> = {
      client_name: clientName,
      status: pick(['scoping', 'active', 'active', 'on_hold', 'delivered']),
      start_date: isoDate(-60 + p * 5),
      account_lead: pick(memberUserIds),
    };
    if (maybe(0.75)) values.budget = 25_000 + Math.floor(rand() * 40) * 2_500;
    if (maybe(0.6)) values.end_date = isoDate(30 + p * 5);
    if (maybe(0.5)) values.scope = `Full-service engagement covering discovery, design and build for ${clientName}.`;

    pending.push(
      finalize(
        {
          id: projectId,
          workspaceId,
          itemTypeId: projectSchema.typeId,
          title,
          parentId: null,
          path,
          position: projectOrder[p] as string,
          isVariantModel: false,
          variantParentId: null,
          variantAxisValues: null,
          values,
          assigneeId: (values.account_lead as string) ?? null,
          createdBy: ownerId,
          updatedBy: ownerId,
        },
        projectSchema,
      ),
    );

    const node = nodeRows.find((n) => n.label === clientName);
    if (node) {
      memberships.push({ workspaceId, itemId: projectId, treeNodeId: node.id, treeId });
    }

    // Tasks under the project, some with subtasks.
    const taskCount = 3 + Math.floor(rand() * 4);
    const taskOrder = appendKeys(null, taskCount);
    for (let t = 0; t < taskCount; t += 1) {
      const taskId = uuid();
      const taskPath = childPath(path, taskId);
      const taskValues: Record<string, unknown> = {
        status: pick(['todo', 'todo', 'in_progress', 'blocked', 'review', 'done']),
        priority: pick(['low', 'medium', 'medium', 'high', 'urgent']),
      };
      if (maybe(0.8)) taskValues.assignee = pick(memberUserIds);
      if (maybe(0.7)) taskValues.due_date = isoDate(-10 + t * 7 + p);
      if (maybe(0.45)) taskValues.estimate_hours = Math.round(rand() * 40 * 2) / 2;
      if (maybe(0.3)) taskValues.notes = 'Waiting on client sign-off before this can progress.';

      pending.push(
        finalize(
          {
            id: taskId,
            workspaceId,
            itemTypeId: taskSchema.typeId,
            title: TASK_TITLES[(p * 3 + t) % TASK_TITLES.length] as string,
            parentId: projectId,
            path: taskPath,
            position: taskOrder[t] as string,
            isVariantModel: false,
            variantParentId: null,
            variantAxisValues: null,
            values: taskValues,
            assigneeId: (taskValues.assignee as string) ?? null,
            createdBy: ownerId,
            updatedBy: ownerId,
          },
          taskSchema,
        ),
      );

      if (maybe(0.35)) {
        const subCount = 1 + Math.floor(rand() * 3);
        const subOrder = appendKeys(null, subCount);
        for (let s = 0; s < subCount; s += 1) {
          const subId = uuid();
          const subValues: Record<string, unknown> = {
            status: pick(['todo', 'in_progress', 'done']),
            priority: pick(['low', 'medium', 'high']),
          };
          if (maybe(0.6)) subValues.assignee = pick(memberUserIds);
          pending.push(
            finalize(
              {
                id: subId,
                workspaceId,
                itemTypeId: taskSchema.typeId,
                title: `${TASK_TITLES[(t + s) % TASK_TITLES.length]} — part ${s + 1}`,
                parentId: taskId,
                path: childPath(taskPath, subId),
                position: subOrder[s] as string,
                isVariantModel: false,
                variantParentId: null,
                variantAxisValues: null,
                values: subValues,
                assigneeId: (subValues.assignee as string) ?? null,
                createdBy: ownerId,
                updatedBy: ownerId,
              },
              taskSchema,
            ),
          );
        }
      }
    }
  }

  const campaignOrder = appendKeys(null, spec.campaignCount);
  for (let c = 0; c < spec.campaignCount; c += 1) {
    const campaignId = uuid();
    const values: Record<string, unknown> = {
      status: pick(['draft', 'approved', 'live', 'paused', 'complete']),
      channels: [pick(['email', 'paid_social', 'search', 'display'])],
      owner: pick(memberUserIds),
      launch_date: isoDate(-20 + c * 11),
    };
    if (maybe(0.7)) values.budget = 5_000 + Math.floor(rand() * 20) * 1_000;
    if (maybe(0.5)) values.audience = pick(['Existing customers', 'Lapsed buyers', 'Trade partners']);
    if (maybe(0.4)) values.landing_page = 'https://example.com/campaign';

    pending.push(
      finalize(
        {
          id: campaignId,
          workspaceId,
          itemTypeId: campaignSchema.typeId,
          title: CAMPAIGN_TITLES[c % CAMPAIGN_TITLES.length] as string,
          parentId: null,
          path: childPath(null, campaignId),
          position: campaignOrder[c] as string,
          isVariantModel: false,
          variantParentId: null,
          variantAxisValues: null,
          values,
          assigneeId: (values.owner as string) ?? null,
          createdBy: ownerId,
          updatedBy: ownerId,
        },
        campaignSchema,
      ),
    );

    const leaf = leafNodeIds[c % leafNodeIds.length];
    if (leaf) memberships.push({ workspaceId, itemId: campaignId, treeNodeId: leaf, treeId });
  }

  // --- variant models ------------------------------------------------------
  if (productSchema) {
    const regions = ['na', 'emea', 'apac', 'latam'];
    const sizes = ['s', 'm', 'l'];
    const modelOrder = appendKeys(null, PRODUCT_TITLES.length);

    PRODUCT_TITLES.forEach((productTitle, i) => {
      const modelId = uuid();
      const modelValues: Record<string, unknown> = {
        description: `${productTitle} — a hard-wearing staple built for changeable weather.`,
        material: pick(['Waxed cotton', 'Merino wool', 'Recycled nylon']),
        care_instructions: 'Machine wash cold. Do not tumble dry.',
        launch_date: isoDate(45 + i * 14),
        hero_image: 'https://example.com/hero.jpg',
        // Base price on the model: `price` is `variant`-inheritance, so
        // variants inherit this until they deliberately override it.
        price: 90 + i * 10,
      };

      pending.push(
        finalize(
          {
            id: modelId,
            workspaceId,
            itemTypeId: productSchema.typeId,
            title: productTitle,
            parentId: null,
            path: childPath(null, modelId),
            position: modelOrder[i] as string,
            isVariantModel: true,
            variantParentId: null,
            variantAxisValues: null,
            values: modelValues,
            assigneeId: null,
            createdBy: ownerId,
            updatedBy: ownerId,
          },
          productSchema,
        ),
      );

      // A subset of the grid, so the fixture has models with different
      // variant counts rather than a uniform product.
      const regionSlice = regions.slice(0, 2 + i);
      const sizeSlice = sizes.slice(0, 2 + (i % 2));
      const variantKeys = appendKeys(null, regionSlice.length * sizeSlice.length);
      let v = 0;

      for (const region of regionSlice) {
        for (const size of sizeSlice) {
          const variantId = uuid();
          const variantValues: Record<string, unknown> = {
            sku: `${productTitle.slice(0, 3).toUpperCase()}-${region.toUpperCase()}-${size.toUpperCase()}`,
            region,
            size,
          };
          // Most variants inherit the model's base price; a handful override
          // it, so propagation tests have values that must *not* move when
          // the model is edited.
          if (maybe(0.35)) variantValues.price = 80 + Math.floor(rand() * 12) * 5;
          if (maybe(0.6)) variantValues.stock_on_hand = Math.floor(rand() * 400);

          pending.push(
            finalize(
              {
                id: variantId,
                workspaceId,
                itemTypeId: productSchema.typeId,
                title: `${productTitle} · ${region.toUpperCase()} · ${size.toUpperCase()}`,
                parentId: null,
                path: childPath(null, variantId),
                position: variantKeys[v] as string,
                isVariantModel: false,
                variantParentId: modelId,
                variantAxisValues: { region, size },
                values: variantValues,
                assigneeId: null,
                createdBy: ownerId,
                updatedBy: ownerId,
              },
              productSchema,
              modelValues,
            ),
          );
          v += 1;
        }
      }
    });
  }

  // --- persist -------------------------------------------------------------
  for (let i = 0; i < pending.length; i += 500) {
    await db.insert(items).values(pending.slice(i, i + 500) as never);
  }
  if (memberships.length) {
    await db.insert(itemTreeNodes).values(memberships);
    for (const node of nodeRows) {
      const count = memberships.filter((m) => m.treeNodeId === node.id).length;
      if (count > 0) {
        await db
          .update(treeNodes)
          .set({ itemCount: count })
          .where(sql`${treeNodes.id} = ${node.id}`);
      }
    }
  }

  const projectionRows = projectionRowsFor(pending, schemas);
  for (let i = 0; i < projectionRows.length; i += 1000) {
    await db.insert(itemFieldIndex).values(projectionRows.slice(i, i + 1000) as never);
  }

  for (const s of schemas) {
    const count = pending.filter((p) => p.itemTypeId === s.typeId).length;
    await db.update(itemTypes).set({ itemCount: count }).where(sql`${itemTypes.id} = ${s.typeId}`);
  }

  // --- a default view per type --------------------------------------------
  await db.insert(views).values(
    schemas.map((s, i) => ({
      id: uuid(),
      workspaceId,
      itemTypeId: s.typeId,
      kind: 'grid' as const,
      name: 'All items',
      visibility: 'workspace' as const,
      isDefault: true,
      position: i,
      ownerId,
      config: { sort: [{ field: '$title', direction: 'asc' as const }] },
    })),
  );

  // --- guest scope ---------------------------------------------------------
  if (spec.guestEmail) {
    const guestMemberId = memberIdByEmail.get(spec.guestEmail);
    const scopedNode = nodeRows.find((n) => n.label === CLIENT_NAMES[0]);
    if (guestMemberId && scopedNode) {
      await db.insert(guestScopes).values({
        id: uuid(),
        workspaceId,
        memberId: guestMemberId,
        treeNodeId: scopedNode.id,
        includeDescendants: true,
        canEdit: true,
        editableFieldKeys: ['status', 'notes'],
      });
    }
  }

  return { workspaceId, itemCount: pending.length };
}

async function main(): Promise<void> {
  console.log('Truncating…');
  await truncateAll();

  console.log('Seeding users…');
  const userIds = await seedUsers();

  console.log('Seeding workspace "northwind"…');
  const a = await seedWorkspace(
    {
      slug: 'northwind',
      name: 'Northwind Agency',
      members: [
        ['alice@northwind.test', 'owner'],
        ['bob@northwind.test', 'member'],
        ['carol@northwind.test', 'viewer'],
        ['morgan@shared.test', 'admin'],
        ['dana@client.test', 'guest'],
      ],
      guestEmail: 'dana@client.test',
      projectCount: 12,
      campaignCount: 12,
      withProducts: true,
    },
    userIds,
  );

  console.log('Seeding workspace "northwind-partners"…');
  const b = await seedWorkspace(
    {
      slug: 'northwind-partners',
      name: 'Northwind Partners',
      members: [
        ['erin@partners.test', 'owner'],
        ['frank@partners.test', 'member'],
        ['morgan@shared.test', 'viewer'],
      ],
      projectCount: 4,
      campaignCount: 5,
      withProducts: false,
    },
    userIds,
  );

  console.log(`Seeded ${a.itemCount} items in northwind, ${b.itemCount} in northwind-partners.`);
  console.log(`  northwind          ${a.workspaceId}`);
  console.log(`  northwind-partners ${b.workspaceId}`);
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sqlClient.end({ timeout: 5 });
  });
