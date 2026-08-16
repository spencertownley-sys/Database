/**
 * Maintenance of `item_field_index`, the derived read path.
 *
 * The index exists because filtering and sorting on JSONB does not scale: a
 * `values->>'budget' > '5000'` predicate cannot use a B-tree range scan, so it
 * reads every candidate row and filters afterwards. Projecting each indexed
 * field into a typed column turns that into an index scan over a partial index.
 *
 * **This table is derived, always.** Every row is reconstructible from
 * `items.effective_values` plus the field definitions, which is what
 * `rebuildProjection` does and what the nightly `projectionAudit` samples 1% of
 * to prove. Never write here as a primary source: a divergence produces
 * filters that silently omit real items, which in a work tool reads as lost
 * work rather than as a bug.
 *
 * Only fields with `is_indexed` are projected. Indexing every field triples
 * write cost for fields nobody filters; `is_indexed` flips on automatically the
 * first time a field is filtered or sorted, which enqueues `fieldBackfill`.
 */

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Tx } from '@/server/db';
import { itemFieldIndex } from '@/server/db/schema/items';
import type { Field } from '@/server/db/schema/itemTypes';
import type { ItemValues } from '@/server/db/schema/items';
import { handlerFor, toIndexValue } from '@/server/validation/fieldTypes';
import { SEARCHABLE_TYPES } from '@/types/fields';

export type IndexableField = Pick<Field, 'id' | 'key' | 'type' | 'config' | 'isIndexed'>;

export interface ProjectionTarget {
  itemId: string;
  itemTypeId: string;
  effectiveValues: ItemValues;
  /** Omit for a full rebuild; supply to write only what changed. */
  previousEffectiveValues?: ItemValues;
}

interface IndexRow {
  workspaceId: string;
  itemId: string;
  fieldId: string;
  itemTypeId: string;
  valueText: string | null;
  valueNumber: number | null;
  valueDate: Date | null;
  valueBool: boolean | null;
  valueUuid: string | null;
  valueTextArray: string[] | null;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return false;
}

/**
 * Writes the index rows for a batch of items in at most two statements — one
 * upsert and one delete — regardless of how many items or fields changed.
 * A per-field round trip turns a 500-row bulk edit into 20,000 queries.
 */
export async function syncProjection(
  tx: Tx,
  workspaceId: string,
  fields: readonly IndexableField[],
  targets: readonly ProjectionTarget[],
): Promise<{ upserted: number; deleted: number }> {
  const indexed = fields.filter((f) => f.isIndexed);
  if (indexed.length === 0 || targets.length === 0) return { upserted: 0, deleted: 0 };

  const upserts: IndexRow[] = [];
  const deletes: Array<{ itemId: string; fieldId: string }> = [];

  for (const target of targets) {
    const previous = target.previousEffectiveValues;
    for (const field of indexed) {
      const next = target.effectiveValues[field.key] ?? null;

      if (previous !== undefined) {
        const before = previous[field.key] ?? null;
        if (sameValue(before, next)) continue;
      }

      const projected = toIndexValue(field.type, next, field.config);
      if (projected.column === null) {
        deletes.push({ itemId: target.itemId, fieldId: field.id });
        continue;
      }

      upserts.push({
        workspaceId,
        itemId: target.itemId,
        fieldId: field.id,
        itemTypeId: target.itemTypeId,
        valueText: projected.valueText ?? null,
        valueNumber: projected.valueNumber ?? null,
        valueDate: projected.valueDate ?? null,
        valueBool: projected.valueBool ?? null,
        valueUuid: projected.valueUuid ?? null,
        valueTextArray: projected.valueTextArray ?? null,
      });
    }
  }

  // Chunked: each row binds 10 parameters and Postgres caps a statement at
  // 65,534 — a 5,000-item import with a handful of indexed fields blows
  // through that in one statement. 4,000 rows = 40k parameters, safely under.
  for (let i = 0; i < upserts.length; i += 4_000) {
    await tx
      .insert(itemFieldIndex)
      .values(upserts.slice(i, i + 4_000))
      .onConflictDoUpdate({
        target: [itemFieldIndex.itemId, itemFieldIndex.fieldId],
        set: {
          valueText: sql`excluded.value_text`,
          valueNumber: sql`excluded.value_number`,
          valueDate: sql`excluded.value_date`,
          valueBool: sql`excluded.value_bool`,
          valueUuid: sql`excluded.value_uuid`,
          valueTextArray: sql`excluded.value_text_array`,
          itemTypeId: sql`excluded.item_type_id`,
        },
      });
  }

  if (deletes.length > 0) {
    // Grouped by item so the delete is a handful of indexed predicates rather
    // than one OR-chain per (item, field) pair.
    const byItem = new Map<string, string[]>();
    for (const d of deletes) {
      const list = byItem.get(d.itemId);
      if (list) list.push(d.fieldId);
      else byItem.set(d.itemId, [d.fieldId]);
    }
    for (const [itemId, fieldIds] of byItem) {
      await tx
        .delete(itemFieldIndex)
        .where(
          and(eq(itemFieldIndex.itemId, itemId), inArray(itemFieldIndex.fieldId, fieldIds)),
        );
    }
  }

  return { upserted: upserts.length, deleted: deletes.length };
}

/** Drops every index row for the given items, then reprojects from scratch. */
export async function rebuildProjection(
  tx: Tx,
  workspaceId: string,
  fields: readonly IndexableField[],
  targets: readonly ProjectionTarget[],
): Promise<{ upserted: number; deleted: number }> {
  if (targets.length === 0) return { upserted: 0, deleted: 0 };
  await tx.delete(itemFieldIndex).where(
    inArray(
      itemFieldIndex.itemId,
      targets.map((t) => t.itemId),
    ),
  );
  return syncProjection(
    tx,
    workspaceId,
    fields,
    targets.map((t) => ({ ...t, previousEffectiveValues: undefined })),
  );
}

export async function removeProjection(tx: Tx, itemIds: readonly string[]): Promise<void> {
  if (itemIds.length === 0) return;
  await tx.delete(itemFieldIndex).where(inArray(itemFieldIndex.itemId, [...itemIds]));
}

/**
 * `items.search_text` — the trigram-indexed haystack.
 *
 * Title first so a title match ranks naturally under similarity ordering, then
 * the text-ish searchable fields. Select labels are included rather than option
 * ids: searching for "Blocked" must find items whose status *reads* Blocked,
 * and the id is an opaque token nobody types.
 */
export function buildSearchText(
  title: string,
  effectiveValues: ItemValues,
  fields: readonly Pick<Field, 'key' | 'type' | 'config' | 'isSearchable'>[],
): string {
  const parts: string[] = [title];

  for (const field of fields) {
    const value = effectiveValues[field.key];
    if (value === null || value === undefined) continue;

    const included = field.isSearchable || SEARCHABLE_TYPES.has(field.type);
    if (!included && field.type !== 'select' && field.type !== 'multi_select') continue;
    if (!field.isSearchable && (field.type === 'select' || field.type === 'multi_select')) continue;

    const rendered = handlerFor(field.type).format(value, field.config);
    if (rendered) parts.push(rendered);
  }

  return parts
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 8000);
}
