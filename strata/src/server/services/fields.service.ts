/**
 * Field lifecycle: create, rename, retype, soft-delete, restore, and the
 * automatic indexing that keeps the projection cheap.
 *
 * The rule that shapes this file: **`key` is immutable, `label` is not.**
 * `items.values` is keyed by `key`, so renaming a field must never touch
 * stored data — a rename that rewrote every item's JSONB would be the single
 * most data-destructive operation in the product, and it is the one users
 * perform most casually.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Tx } from '@/server/db';
import { fields as fieldsTable, type Field } from '@/server/db/schema/itemTypes';
import { items } from '@/server/db/schema/items';
import { itemFieldIndex } from '@/server/db/schema/items';
import { AppError } from '@/server/lib/errors';
import { appendKeys } from '@/server/lib/fractionalIndex';
import { cacheDelete } from '@/server/lib/redis';
import { coerceValue } from '@/server/validation/fieldTypes';
import { LOSSLESS_CONVERSIONS, type FieldConfig, type FieldType } from '@/types/fields';
import { requiredFieldNeedsAcknowledgement } from './completeness.service';
import { slugifyKey, assertValidKey } from './itemTypes.service';

/**
 * Turns on `is_indexed` for fields a query just referenced, and enqueues a
 * backfill for their existing values.
 *
 * Indexing every field up front triples write cost for fields nobody ever
 * filters. Indexing on first use costs one extra write the first time a field
 * is filtered and nothing thereafter.
 */
export async function ensureFieldsIndexed(
  tx: Tx,
  workspaceId: string,
  fieldKeys: readonly string[],
  liveFields: readonly Field[],
): Promise<string[]> {
  if (fieldKeys.length === 0) return [];

  const byKey = new Map(liveFields.map((f) => [f.key, f]));
  const toIndex = fieldKeys
    .map((key) => byKey.get(key))
    .filter((f): f is Field => f !== undefined && !f.isIndexed);

  if (toIndex.length === 0) return [];

  await tx
    .update(fieldsTable)
    .set({ isIndexed: true, updatedAt: new Date() })
    .where(
      and(
        eq(fieldsTable.workspaceId, workspaceId),
        inArray(
          fieldsTable.id,
          toIndex.map((f) => f.id),
        ),
      ),
    );

  // Backfill inline. Above a few thousand items this is the `fieldBackfill`
  // job's work; the sync path exists so the very first filter on a small
  // workspace returns correct results immediately rather than an empty grid.
  for (const field of toIndex) {
    await backfillField(tx, workspaceId, field);
  }

  return toIndex.map((f) => f.id);
}

/**
 * Populates `item_field_index` for one field across every item of its type.
 *
 * Written as a single INSERT … SELECT rather than a read-modify-write loop:
 * pulling 100k rows into the application to project one field would blow both
 * the memory and the time budget, and the coercion has already happened — the
 * values in `effective_values` are canonical.
 */
export async function backfillField(tx: Tx, workspaceId: string, field: Field): Promise<number> {
  const key = field.key;
  const valueExpr = sql`i.effective_values -> ${key}`;

  const columnAssignment = (() => {
    switch (field.type) {
      case 'number':
      case 'currency':
      case 'percent':
        return sql`null, (${valueExpr})::text::numeric, null, null, null, null`;
      case 'date':
        return sql`null, null, ((${valueExpr})::text::date)::timestamptz, null, null, null`;
      case 'datetime':
        return sql`null, null, (i.effective_values ->> ${key})::timestamptz, null, null, null`;
      case 'checkbox':
        return sql`null, null, null, (${valueExpr})::text::boolean, null, null`;
      case 'user':
      case 'relation':
        return (field.config as { multiple?: boolean }).multiple
          ? sql`null, null, null, null, null, (select array_agg(x) from jsonb_array_elements_text(${valueExpr}) x)`
          : sql`null, null, null, null, (i.effective_values ->> ${key})::uuid, null`;
      case 'multi_select':
        return sql`null, null, null, null, null, (select array_agg(x) from jsonb_array_elements_text(${valueExpr}) x)`;
      default:
        return sql`i.effective_values ->> ${key}, null, null, null, null, null`;
    }
  })();

  const result = await tx.execute(sql`
    insert into item_field_index (
      workspace_id, item_id, field_id, item_type_id,
      value_text, value_number, value_date, value_bool, value_uuid, value_text_array
    )
    select ${workspaceId}::uuid, i.id, ${field.id}::uuid, i.item_type_id, ${columnAssignment}
    from items i
    where i.workspace_id = ${workspaceId}::uuid
      and i.item_type_id = ${field.itemTypeId}::uuid
      and i.deleted_at is null
      and i.effective_values ? ${key}
      and jsonb_typeof(i.effective_values -> ${key}) <> 'null'
    on conflict (item_id, field_id) do update set
      value_text = excluded.value_text,
      value_number = excluded.value_number,
      value_date = excluded.value_date,
      value_bool = excluded.value_bool,
      value_uuid = excluded.value_uuid,
      value_text_array = excluded.value_text_array
  `);

  return Array.isArray(result) ? result.length : 0;
}

export interface CreateFieldInput {
  itemTypeId: string;
  label: string;
  key?: string;
  type: FieldType;
  config?: FieldConfig;
  requiredForCompleteness?: boolean;
  inheritance?: 'shared' | 'variant';
  helpText?: string;
  fieldGroupId?: string | null;
  defaultValue?: unknown;
  isSearchable?: boolean;
  acknowledgeIncomplete?: boolean;
}

export async function createField(
  tx: Tx,
  workspaceId: string,
  input: CreateFieldInput,
  actorId: string | null,
): Promise<Field> {
  const existing = await listFields(tx, workspaceId, input.itemTypeId);
  const taken = new Set(existing.map((f) => f.key));
  const key = input.key ?? slugifyKey(input.label, taken);
  assertValidKey(key);
  if (taken.has(key)) {
    throw new AppError('FIELD_KEY_TAKEN', `A field with the key "${key}" already exists here.`);
  }

  if (input.requiredForCompleteness) {
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(items)
      .where(
        and(
          eq(items.workspaceId, workspaceId),
          eq(items.itemTypeId, input.itemTypeId),
          isNull(items.deletedAt),
        ),
      );

    const hasDefault = input.defaultValue !== undefined && input.defaultValue !== null;
    if (requiredFieldNeedsAcknowledgement(count, hasDefault) && !input.acknowledgeIncomplete) {
      // Adding a required field to a type in use drops every existing item's
      // completeness overnight. Surfacing that before it happens is the
      // difference between a metric people trust and one they learn to ignore.
      throw new AppError(
        'REQUIRED_FIELD_NEEDS_ACKNOWLEDGEMENT',
        `${count.toLocaleString()} existing ${count === 1 ? 'item' : 'items'} have no value for this field, so their completeness will drop. Give the field a default value, or confirm you want to leave them incomplete.`,
        { affectedItems: count },
      );
    }
  }

  const lastKey = existing[existing.length - 1]?.orderKey ?? null;
  const [orderKey] = appendKeys(lastKey, 1);

  const [created] = await tx
    .insert(fieldsTable)
    .values({
      workspaceId,
      itemTypeId: input.itemTypeId,
      fieldGroupId: input.fieldGroupId ?? null,
      key,
      label: input.label,
      type: input.type,
      config: (input.config ?? {}) as FieldConfig,
      helpText: input.helpText ?? null,
      requiredForCompleteness: input.requiredForCompleteness ?? false,
      defaultValue: input.defaultValue ?? null,
      inheritance: input.inheritance ?? 'variant',
      isSearchable: input.isSearchable ?? false,
      orderKey: orderKey as string,
      createdBy: actorId,
    })
    .returning();

  if (!created) throw new AppError('INTERNAL', 'Could not create the field.');
  await invalidateSchemaCache(workspaceId, input.itemTypeId);
  return created;
}

export async function listFields(
  tx: Tx,
  workspaceId: string,
  itemTypeId: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<Field[]> {
  return tx
    .select()
    .from(fieldsTable)
    .where(
      and(
        eq(fieldsTable.workspaceId, workspaceId),
        eq(fieldsTable.itemTypeId, itemTypeId),
        opts.includeDeleted ? undefined : isNull(fieldsTable.deletedAt),
      ),
    )
    .orderBy(fieldsTable.orderKey);
}

export interface ConversionPreview {
  total: number;
  /** Values that convert with no change in meaning. */
  clean: number;
  /** Values coerced into the new type (e.g. "1,250" → 1250). */
  coerced: number;
  /** Values that cannot convert; kept in `invalid_values` as typed. */
  preservedAsText: number;
  samples: Array<{ itemId: string; before: unknown; after: unknown; message?: string }>;
  lossless: boolean;
}

/**
 * Dry-runs a type change over the real values.
 *
 * Nothing is written. The counts are what the builder shows before asking for
 * confirmation — "142 clean, 8 coerced, 3 kept as text" is a decision a person
 * can make; "are you sure?" is not.
 */
export async function previewFieldTypeChange(
  tx: Tx,
  workspaceId: string,
  field: Field,
  nextType: FieldType,
  nextConfig: FieldConfig,
): Promise<ConversionPreview> {
  const rows = await tx
    .select({ id: items.id, effectiveValues: items.effectiveValues })
    .from(items)
    .where(
      and(
        eq(items.workspaceId, workspaceId),
        eq(items.itemTypeId, field.itemTypeId),
        isNull(items.deletedAt),
      ),
    );

  let clean = 0;
  let coerced = 0;
  let preservedAsText = 0;
  const samples: ConversionPreview['samples'] = [];

  for (const row of rows) {
    const before = row.effectiveValues[field.key];
    if (before === null || before === undefined) continue;

    const result = coerceValue(nextType, before, nextConfig);
    if (!result.ok) {
      preservedAsText += 1;
      if (samples.length < 20) {
        samples.push({ itemId: row.id, before, after: null, message: result.message });
      }
      continue;
    }

    if (result.value === before) clean += 1;
    else {
      coerced += 1;
      if (samples.length < 20) samples.push({ itemId: row.id, before, after: result.value });
    }
  }

  return {
    total: rows.length,
    clean,
    coerced,
    preservedAsText,
    samples,
    lossless: LOSSLESS_CONVERSIONS[field.type]?.has(nextType) ?? false,
  };
}

export async function updateField(
  tx: Tx,
  workspaceId: string,
  fieldId: string,
  patch: Partial<CreateFieldInput> & { confirmConversion?: boolean },
): Promise<{ field: Field; conversion?: ConversionPreview }> {
  const [field] = await tx
    .select()
    .from(fieldsTable)
    .where(and(eq(fieldsTable.workspaceId, workspaceId), eq(fieldsTable.id, fieldId)))
    .limit(1);

  if (!field) throw new AppError('NOT_FOUND', 'That field no longer exists.');

  if (patch.key !== undefined && patch.key !== field.key) {
    throw new AppError(
      'FIELD_KEY_IMMUTABLE',
      'A field key cannot change once it exists — every stored value is keyed by it. Rename the label instead.',
    );
  }

  const typeChanged = patch.type !== undefined && patch.type !== field.type;
  let conversion: ConversionPreview | undefined;

  if (typeChanged) {
    conversion = await previewFieldTypeChange(
      tx,
      workspaceId,
      field,
      patch.type as FieldType,
      (patch.config ?? field.config) as FieldConfig,
    );
    if (!patch.confirmConversion && (conversion.coerced > 0 || conversion.preservedAsText > 0)) {
      return { field, conversion };
    }
  }

  const [updated] = await tx
    .update(fieldsTable)
    .set({
      label: patch.label ?? field.label,
      type: (patch.type ?? field.type) as FieldType,
      config: (patch.config ?? field.config) as FieldConfig,
      helpText: patch.helpText ?? field.helpText,
      requiredForCompleteness:
        patch.requiredForCompleteness ?? field.requiredForCompleteness,
      inheritance: patch.inheritance ?? field.inheritance,
      defaultValue: patch.defaultValue ?? field.defaultValue,
      isSearchable: patch.isSearchable ?? field.isSearchable,
      fieldGroupId: patch.fieldGroupId === undefined ? field.fieldGroupId : patch.fieldGroupId,
      updatedAt: new Date(),
    })
    .where(eq(fieldsTable.id, fieldId))
    .returning();

  if (!updated) throw new AppError('INTERNAL', 'Could not update the field.');

  if (typeChanged) {
    // The stored values are re-coerced by the caller's change set; the index
    // rows are keyed by field id and now hold the wrong storage class, so they
    // are cleared and rebuilt from the new type.
    await tx.delete(itemFieldIndex).where(eq(itemFieldIndex.fieldId, fieldId));
    if (updated.isIndexed) await backfillField(tx, workspaceId, updated);
  }

  await invalidateSchemaCache(workspaceId, field.itemTypeId);
  return { field: updated };
}

/**
 * Soft-deletes a field. Values are retained for 30 days so a restore is a
 * restore, not a re-entry — deleting a column by accident is common, and
 * losing every value in it is not recoverable from a backup without losing
 * everything else written since.
 */
export async function deleteField(tx: Tx, workspaceId: string, fieldId: string): Promise<void> {
  const [field] = await tx
    .select()
    .from(fieldsTable)
    .where(and(eq(fieldsTable.workspaceId, workspaceId), eq(fieldsTable.id, fieldId)))
    .limit(1);

  if (!field) throw new AppError('NOT_FOUND', 'That field no longer exists.');

  await tx
    .update(fieldsTable)
    .set({ deletedAt: new Date() })
    .where(eq(fieldsTable.id, fieldId));

  // The projection is a live read path, so its rows go immediately; the
  // authoritative values stay in `items.values` for the restore window.
  await tx.delete(itemFieldIndex).where(eq(itemFieldIndex.fieldId, fieldId));
  await invalidateSchemaCache(workspaceId, field.itemTypeId);
}

export const FIELD_RESTORE_WINDOW_DAYS = 30;

export async function restoreField(tx: Tx, workspaceId: string, fieldId: string): Promise<Field> {
  const [field] = await tx
    .select()
    .from(fieldsTable)
    .where(and(eq(fieldsTable.workspaceId, workspaceId), eq(fieldsTable.id, fieldId)))
    .limit(1);

  if (!field) throw new AppError('NOT_FOUND', 'That field no longer exists.');
  if (!field.deletedAt) return field;

  const ageDays = (Date.now() - field.deletedAt.getTime()) / 86_400_000;
  if (ageDays > FIELD_RESTORE_WINDOW_DAYS) {
    throw new AppError(
      'NOT_FOUND',
      `"${field.label}" was deleted more than ${FIELD_RESTORE_WINDOW_DAYS} days ago and can no longer be restored.`,
    );
  }

  const clash = await tx
    .select({ id: fieldsTable.id })
    .from(fieldsTable)
    .where(
      and(
        eq(fieldsTable.itemTypeId, field.itemTypeId),
        eq(fieldsTable.key, field.key),
        isNull(fieldsTable.deletedAt),
      ),
    )
    .limit(1);

  if (clash[0]) {
    throw new AppError(
      'FIELD_KEY_TAKEN',
      `A field using the key "${field.key}" was created after this one was deleted. Rename it before restoring.`,
    );
  }

  const [restored] = await tx
    .update(fieldsTable)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(eq(fieldsTable.id, fieldId))
    .returning();

  if (!restored) throw new AppError('INTERNAL', 'Could not restore the field.');
  if (restored.isIndexed) await backfillField(tx, workspaceId, restored);
  await invalidateSchemaCache(workspaceId, field.itemTypeId);
  return restored;
}

export async function reorderField(
  tx: Tx,
  workspaceId: string,
  fieldId: string,
  orderKey: string,
): Promise<void> {
  await tx
    .update(fieldsTable)
    .set({ orderKey, updatedAt: new Date() })
    .where(and(eq(fieldsTable.workspaceId, workspaceId), eq(fieldsTable.id, fieldId)));
}

async function invalidateSchemaCache(workspaceId: string, itemTypeId: string): Promise<void> {
  await cacheDelete(`schema:${workspaceId}:${itemTypeId}`);
}
