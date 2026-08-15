import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '@/server/db';
import {
  fieldGroups,
  fields as fieldsTable,
  itemTypes,
  type Field,
  type FieldGroup,
  type ItemType,
} from '@/server/db/schema/itemTypes';
import { items } from '@/server/db/schema/items';
import { AppError } from '@/server/lib/errors';
import { appendKeys, firstKey } from '@/server/lib/fractionalIndex';
import { PRESETS_BY_KEY, type ItemTypePreset } from '@/components/type-builder/presets';
import { VARIANT_AXIS_TYPES } from '@/types/fields';

export interface ItemTypeWithSchema extends ItemType {
  fields: Field[];
  groups: FieldGroup[];
}

const KEY_RE = /^[a-z][a-z0-9_]{0,62}$/;

/**
 * Derives a stable machine key from a human name.
 *
 * Keys are immutable once written — `items.values` is keyed by them — so this
 * runs exactly once, at creation. Renaming the label later must never call it.
 */
export function slugifyKey(name: string, taken: ReadonlySet<string> = new Set()): string {
  const base =
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .replace(/^(\d)/, 'f_$1')
      .slice(0, 60) || 'field';

  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new AppError('CONFLICT', `Could not derive a unique key from "${name}".`);
}

export function assertValidKey(key: string): void {
  if (!KEY_RE.test(key)) {
    throw new AppError(
      'VALIDATION_FAILED',
      `"${key}" is not a valid key. Use lowercase letters, digits and underscores, starting with a letter.`,
    );
  }
}

export async function listItemTypes(tx: Tx, workspaceId: string): Promise<ItemType[]> {
  return tx
    .select()
    .from(itemTypes)
    .where(and(eq(itemTypes.workspaceId, workspaceId), isNull(itemTypes.deletedAt)))
    .orderBy(asc(itemTypes.name));
}

/**
 * Loads a type with its live fields and groups.
 *
 * Soft-deleted fields are excluded here but their *values* stay on the item —
 * that is what makes the 30-day restore a restore rather than a re-entry.
 */
export async function getItemTypeWithSchema(
  tx: Tx,
  workspaceId: string,
  itemTypeId: string,
): Promise<ItemTypeWithSchema> {
  const [type] = await tx
    .select()
    .from(itemTypes)
    .where(
      and(
        eq(itemTypes.workspaceId, workspaceId),
        eq(itemTypes.id, itemTypeId),
        isNull(itemTypes.deletedAt),
      ),
    )
    .limit(1);

  if (!type) throw new AppError('NOT_FOUND', 'That item type no longer exists.');

  const [typeFields, groups] = await Promise.all([
    tx
      .select()
      .from(fieldsTable)
      .where(and(eq(fieldsTable.itemTypeId, itemTypeId), isNull(fieldsTable.deletedAt)))
      .orderBy(asc(fieldsTable.orderKey)),
    tx
      .select()
      .from(fieldGroups)
      .where(eq(fieldGroups.itemTypeId, itemTypeId))
      .orderBy(asc(fieldGroups.orderKey)),
  ]);

  return { ...type, fields: typeFields, groups };
}

export interface CreateItemTypeInput {
  key?: string;
  name: string;
  pluralName?: string;
  description?: string;
  icon?: string;
  color?: string;
  presetKey?: string;
}

export async function createItemType(
  tx: Tx,
  workspaceId: string,
  input: CreateItemTypeInput,
  actorId: string | null,
): Promise<ItemType> {
  const existing = await listItemTypes(tx, workspaceId);
  const taken = new Set(existing.map((t) => t.key));
  const key = input.key ?? slugifyKey(input.name, taken);
  assertValidKey(key);
  if (taken.has(key)) {
    throw new AppError('CONFLICT', `An item type with the key "${key}" already exists.`);
  }

  const [created] = await tx
    .insert(itemTypes)
    .values({
      workspaceId,
      key,
      name: input.name,
      pluralName: input.pluralName ?? `${input.name}s`,
      description: input.description ?? null,
      icon: input.icon ?? 'square',
      color: input.color ?? 'slate',
      presetKey: input.presetKey ?? null,
      createdBy: actorId,
    })
    .returning();

  if (!created) throw new AppError('INTERNAL', 'Item type was not created.');
  return created;
}

/**
 * Instantiates a preset: the type, its field groups, and its fields, in one
 * pass. Used by the builder and by workspace bootstrap, so a seeded workspace
 * and a hand-created one produce byte-identical schemas.
 */
export async function createItemTypeFromPreset(
  tx: Tx,
  workspaceId: string,
  presetKey: string,
  actorId: string | null,
  overrides: { name?: string; key?: string } = {},
): Promise<ItemTypeWithSchema> {
  const preset = PRESETS_BY_KEY[presetKey];
  if (!preset) throw new AppError('NOT_FOUND', `No preset named "${presetKey}".`);

  const type = await createItemType(
    tx,
    workspaceId,
    {
      key: overrides.key,
      name: overrides.name ?? preset.name,
      pluralName: preset.pluralName,
      description: preset.description,
      icon: preset.icon,
      color: preset.color,
      presetKey: preset.key,
    },
    actorId,
  );

  const { groups, fields } = await applyPresetSchema(tx, workspaceId, type.id, preset, actorId);

  if (preset.variantAxes?.length) {
    assertVariantAxes(preset.variantAxes, fields);
    await tx
      .update(itemTypes)
      .set({ variantAxes: preset.variantAxes, updatedAt: new Date() })
      .where(eq(itemTypes.id, type.id));
    type.variantAxes = preset.variantAxes;
  }

  return { ...type, fields, groups };
}

async function applyPresetSchema(
  tx: Tx,
  workspaceId: string,
  itemTypeId: string,
  preset: ItemTypePreset,
  actorId: string | null,
): Promise<{ groups: FieldGroup[]; fields: Field[] }> {
  const groupKeys = appendKeys(null, Math.max(preset.groups.length, 1));
  const insertedGroups = preset.groups.length
    ? await tx
        .insert(fieldGroups)
        .values(
          preset.groups.map((g, i) => ({
            workspaceId,
            itemTypeId,
            key: g.key,
            label: g.label,
            orderKey: groupKeys[i] ?? firstKey(),
            collapsedByDefault: g.collapsedByDefault ?? false,
          })),
        )
        .returning()
    : [];

  const groupIdByKey = new Map(insertedGroups.map((g) => [g.key, g.id]));
  const fieldOrderKeys = appendKeys(null, preset.fields.length);

  const insertedFields = preset.fields.length
    ? await tx
        .insert(fieldsTable)
        .values(
          preset.fields.map((f, i) => ({
            workspaceId,
            itemTypeId,
            fieldGroupId: f.group ? (groupIdByKey.get(f.group) ?? null) : null,
            key: f.key,
            label: f.label,
            type: f.type,
            config: f.config ?? {},
            helpText: f.helpText ?? null,
            required: f.required ?? false,
            defaultValue: f.defaultValue ?? null,
            inheritance: f.inheritance ?? 'variant',
            isIndexed: f.isIndexed ?? false,
            isSearchable: f.isSearchable ?? false,
            countsTowardCompleteness: f.countsTowardCompleteness ?? true,
            orderKey: fieldOrderKeys[i] ?? firstKey(),
            createdBy: actorId,
          })),
        )
        .returning()
    : [];

  return { groups: insertedGroups, fields: insertedFields };
}

/**
 * A variant axis must be a `select` field with `variant` inheritance. A
 * `shared` axis field would resolve every variant to the model's value, which
 * is the exact opposite of what an axis means.
 */
export function assertVariantAxes(axisKeys: readonly string[], typeFields: readonly Field[]): void {
  const byKey = new Map(typeFields.map((f) => [f.key, f]));
  for (const key of axisKeys) {
    const field = byKey.get(key);
    if (!field) {
      throw new AppError('VARIANT_AXIS_INVALID', `There is no field named "${key}" to use as an axis.`);
    }
    if (!VARIANT_AXIS_TYPES.has(field.type)) {
      throw new AppError(
        'VARIANT_AXIS_INVALID',
        `"${field.label}" is a ${field.type} field. Variant axes must be single-select fields.`,
      );
    }
    if (field.inheritance !== 'variant') {
      throw new AppError(
        'VARIANT_AXIS_INVALID',
        `"${field.label}" must be set to vary per variant before it can be an axis.`,
      );
    }
  }
}

export async function updateItemType(
  tx: Tx,
  workspaceId: string,
  itemTypeId: string,
  patch: Partial<Pick<ItemType, 'name' | 'pluralName' | 'description' | 'icon' | 'color' | 'variantAxes'>>,
): Promise<ItemType> {
  if (patch.variantAxes) {
    const { fields } = await getItemTypeWithSchema(tx, workspaceId, itemTypeId);
    assertVariantAxes(patch.variantAxes, fields);
  }

  const [updated] = await tx
    .update(itemTypes)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(itemTypes.workspaceId, workspaceId), eq(itemTypes.id, itemTypeId)))
    .returning();

  if (!updated) throw new AppError('NOT_FOUND', 'That item type no longer exists.');
  return updated;
}

/**
 * Soft-deletes a type. Refuses while items still reference it: hard-deleting
 * the schema would leave orphaned `values` keyed by fields that no longer
 * exist, and the restore path could not reconstruct them.
 */
export async function deleteItemType(
  tx: Tx,
  workspaceId: string,
  itemTypeId: string,
): Promise<void> {
  const [{ count } = { count: 0 }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(items)
    .where(
      and(
        eq(items.workspaceId, workspaceId),
        eq(items.itemTypeId, itemTypeId),
        isNull(items.deletedAt),
      ),
    );

  if (count > 0) {
    throw new AppError(
      'ITEM_TYPE_IN_USE',
      `${count} item${count === 1 ? '' : 's'} still use this type. Delete or re-type them first.`,
      { itemCount: count },
    );
  }

  await tx
    .update(itemTypes)
    .set({ deletedAt: new Date() })
    .where(and(eq(itemTypes.workspaceId, workspaceId), eq(itemTypes.id, itemTypeId)));
}
