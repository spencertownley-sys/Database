/**
 * Variant inheritance.
 *
 * A **model** owns the canonical values. A **variant** is a child row keyed by
 * a coordinate on one or more axes (`{ region: 'emea', size: 'lg' }`) that
 * resolves its values against the model at write time.
 *
 * Two rules define the whole system:
 *
 *  1. **Override is key presence, not a flag.** `variant.values[key]` existing
 *     *is* the override; deleting the key reverts to the model. An
 *     `is_overridden` boolean alongside the value creates two sources of truth
 *     that will disagree the first time a bulk edit writes one and not the
 *     other, and the disagreement is invisible until a customer notices a
 *     price that will not revert.
 *
 *  2. **`effective_values` is materialised, not computed on read.** Filtering
 *     and sorting 100k variants through an inheritance resolution in SQL is
 *     not affordable, so resolution happens once per write and the result is
 *     stored. That makes propagation a real job with a real duration — above
 *     `VARIANT_SYNC_THRESHOLD` it runs asynchronously, and the UI must say so
 *     rather than implying the write finished.
 *
 * `inheritance: 'shared'` fields fall through to the model unless overridden.
 * `inheritance: 'variant'` fields never fall through: marking a field
 * per-variant is a statement that the model's value is not meaningful for a
 * variant, so showing it as inherited would be a lie the grid then filters on.
 */

import type { Field } from '@/server/db/schema/itemTypes';
import type { ItemValues } from '@/server/db/schema/items';
import { AppError } from '@/server/lib/errors';

/** Hard cap per model. Generating a 6×8×5 axis grid is a mistake, not a plan. */
export const MAX_VARIANTS_PER_MODEL = 200;

export interface EffectiveValueResolution {
  values: ItemValues;
  /** Field keys whose effective value came from the model. */
  inheritedKeys: string[];
  /** Field keys the variant overrides. */
  overriddenKeys: string[];
}

/**
 * Resolves what a variant actually shows.
 *
 * `modelValues` is the model's own `values` (not its `effective_values` — a
 * model has no parent, so they are equal, and reading the derived column here
 * would make the function order-dependent on the model's own recompute).
 */
export function computeEffectiveValues(
  modelValues: ItemValues,
  variantValues: ItemValues,
  fields: readonly Pick<Field, 'key' | 'inheritance'>[],
): EffectiveValueResolution {
  const values: ItemValues = {};
  const inheritedKeys: string[] = [];
  const overriddenKeys: string[] = [];

  for (const field of fields) {
    const key = field.key;
    const hasOwn = Object.prototype.hasOwnProperty.call(variantValues, key);

    if (field.inheritance === 'variant') {
      // Never inherited. An absent value is genuinely absent, and completeness
      // is expected to reflect that — "which variants still need a local
      // price" is the question this mode exists to answer.
      if (hasOwn && variantValues[key] !== undefined) {
        values[key] = variantValues[key];
        overriddenKeys.push(key);
      }
      continue;
    }

    if (hasOwn && variantValues[key] !== undefined) {
      values[key] = variantValues[key];
      overriddenKeys.push(key);
    } else if (
      Object.prototype.hasOwnProperty.call(modelValues, key) &&
      modelValues[key] !== undefined &&
      modelValues[key] !== null
    ) {
      values[key] = modelValues[key];
      inheritedKeys.push(key);
    }
  }

  return { values, inheritedKeys, overriddenKeys };
}

/**
 * For a model or a plain (non-variant) item, the effective values are its own.
 * Kept as a named function so callers never have to decide whether to copy or
 * reference the object — this always returns a fresh one.
 */
export function ownEffectiveValues(
  values: ItemValues,
  fields: readonly Pick<Field, 'key'>[],
): ItemValues {
  const out: ItemValues = {};
  for (const field of fields) {
    const v = values[field.key];
    if (v !== undefined && v !== null) out[field.key] = v;
  }
  return out;
}

export function isInherited(
  key: string,
  variantValues: ItemValues,
  field: Pick<Field, 'inheritance'>,
): boolean {
  if (field.inheritance === 'variant') return false;
  return !Object.prototype.hasOwnProperty.call(variantValues, key);
}

/**
 * Reverting an override is a key *deletion*, never a write of the model's
 * current value — writing the value back would silently pin the variant to
 * today's model value and break the next propagation.
 */
export function revertOverride(variantValues: ItemValues, key: string): ItemValues {
  const next = { ...variantValues };
  delete next[key];
  return next;
}

export interface AxisSpec {
  /** Field key of a `select` field named in `item_types.variant_axes`. */
  fieldKey: string;
  /** Option ids to generate across. */
  optionIds: string[];
}

/** Cartesian product of the axes: one coordinate object per variant. */
export function expandAxes(axes: readonly AxisSpec[]): Array<Record<string, string>> {
  if (axes.length === 0) return [];
  let combos: Array<Record<string, string>> = [{}];
  for (const axis of axes) {
    if (axis.optionIds.length === 0) {
      throw new AppError(
        'VARIANT_AXIS_INVALID',
        `Pick at least one value for "${axis.fieldKey}" before generating variants.`,
      );
    }
    const next: Array<Record<string, string>> = [];
    for (const combo of combos) {
      for (const optionId of axis.optionIds) {
        next.push({ ...combo, [axis.fieldKey]: optionId });
      }
    }
    combos = next;
  }
  return combos;
}

export function assertVariantLimit(existingCount: number, adding: number): void {
  const total = existingCount + adding;
  if (total > MAX_VARIANTS_PER_MODEL) {
    throw new AppError(
      'VARIANT_LIMIT_EXCEEDED',
      `That would make ${total} variants; the limit is ${MAX_VARIANTS_PER_MODEL} per model. ` +
        `Narrow the axis values, or split the model.`,
      { existingCount, adding, limit: MAX_VARIANTS_PER_MODEL },
    );
  }
}

/** Stable key for a coordinate, used to detect duplicates during generation. */
export function axisCoordinateKey(coordinate: Record<string, string>): string {
  return Object.keys(coordinate)
    .sort()
    .map((k) => `${k}=${coordinate[k]}`)
    .join('|');
}

/**
 * Which variants a model write actually needs to touch. A shared field that
 * every variant overrides propagates to nobody, and computing that up front
 * keeps a 200-variant model from enqueueing 200 no-op writes.
 */
export function variantsAffectedByModelChange(
  changedKeys: readonly string[],
  fieldsByKey: ReadonlyMap<string, Pick<Field, 'key' | 'inheritance'>>,
  variants: ReadonlyArray<{ id: string; values: ItemValues }>,
): string[] {
  const sharedChanged = changedKeys.filter(
    (k) => fieldsByKey.get(k)?.inheritance !== 'variant',
  );
  if (sharedChanged.length === 0) return [];
  return variants
    .filter((v) =>
      sharedChanged.some((k) => !Object.prototype.hasOwnProperty.call(v.values, k)),
    )
    .map((v) => v.id);
}
