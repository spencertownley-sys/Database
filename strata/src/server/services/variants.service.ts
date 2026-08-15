/**
 * Variant inheritance — the Tech Spec §2.5 resolution algorithm.
 *
 * A **model** owns the canonical values. A **variant** is a child row keyed by
 * a coordinate on one or more axes (`{ region: 'emea', size: 'lg' }`) that
 * resolves its values against the model at write time.
 *
 * The two inheritance modes, exactly as §2.5 defines them:
 *
 *   - `'shared'`  — owned by the model, **read-only on every variant**. The
 *     effective value is always the model's; the write path refuses a variant
 *     write with `FIELD_READ_ONLY`. This is the "change the tagline once and
 *     all fourteen regions update" mode, and it only works if a variant cannot
 *     quietly pin its own copy.
 *
 *   - `'variant'` — owned per variant, **inheriting the model's value until
 *     overridden**. The model's value is the default; a variant that writes
 *     the key owns it from then on.
 *
 * A final pass forces every declared axis field to the variant's own value
 * regardless of inheritance mode — a variant whose Region cell showed the
 * model's region would not be identifiable as itself.
 *
 * Two rules define the rest of the system:
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
 * Resolves what a variant actually shows — Tech Spec §2.5, verbatim.
 *
 * `modelValues` is the model's own `values` (not its `effective_values` — a
 * model has no parent, so they are equal, and reading the derived column here
 * would make the function order-dependent on the model's own recompute).
 *
 * `variantAxes` is the item type's declared axis field keys. Axis values are
 * always the variant's own, whatever the axis field's inheritance mode says.
 *
 * A resolved value of `null`/`undefined` is stored as an absent key rather
 * than an explicit null: everything downstream (`isEmpty`, the projection,
 * completeness) treats the two identically, and one canonical shape is what
 * lets undo compare snapshots byte-for-byte.
 */
export function computeEffectiveValues(
  modelValues: ItemValues,
  variantValues: ItemValues,
  fields: readonly Pick<Field, 'key' | 'inheritance'>[],
  variantAxes: readonly string[] = [],
): EffectiveValueResolution {
  const values: ItemValues = {};
  const inheritedKeys: string[] = [];
  const overriddenKeys: string[] = [];
  const axisKeys = new Set(variantAxes);

  const put = (key: string, value: unknown, bucket?: string[]): void => {
    if (value === undefined || value === null) return;
    values[key] = value;
    bucket?.push(key);
  };

  for (const field of fields) {
    const key = field.key;
    if (axisKeys.has(key)) continue; // the axis pass below owns these

    if (field.inheritance === 'shared') {
      // Always the model's. A variant's own copy — if some historical write
      // left one behind — is ignored, not merged: shared means shared.
      put(key, modelValues[key], inheritedKeys);
      continue;
    }

    // 'variant': the variant's value when the key is present (key presence
    // *is* the override), otherwise inherit whatever the model has. §2.5
    // writes this arm as `item.values[key] ?? model.values[key]` — a nullish
    // coalesce — so a null left on the variant is "no override", not an
    // override-to-empty. The write path never stores null (clearing deletes
    // the key), so this branch only matters for defensive completeness.
    if (
      Object.prototype.hasOwnProperty.call(variantValues, key) &&
      variantValues[key] !== undefined &&
      variantValues[key] !== null
    ) {
      put(key, variantValues[key], overriddenKeys);
    } else {
      put(key, modelValues[key], inheritedKeys);
    }
  }

  // Axis values always come from the variant itself.
  for (const key of axisKeys) {
    put(key, variantValues[key]);
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
  variantAxes: readonly string[] = [],
): boolean {
  if (variantAxes.includes(key)) return false; // an axis value is the variant's identity
  if (field.inheritance === 'shared') return true; // read-only, always the model's
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
        'INVALID_VARIANT_AXIS',
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
 * Which variants a model write actually needs to touch.
 *
 * A `shared` field flows to every variant unconditionally — variants cannot
 * override it. A `variant`-inheritance field flows only to variants that have
 * not overridden it, and an axis field flows to nobody (the axis pass always
 * takes the variant's own value). Computing this up front keeps a 200-variant
 * model from enqueueing 200 no-op writes.
 */
export function variantsAffectedByModelChange(
  changedKeys: readonly string[],
  fieldsByKey: ReadonlyMap<string, Pick<Field, 'key' | 'inheritance'>>,
  variants: ReadonlyArray<{ id: string; values: ItemValues }>,
  variantAxes: readonly string[] = [],
): string[] {
  const axisKeys = new Set(variantAxes);
  const flowing = changedKeys.filter((k) => !axisKeys.has(k) && fieldsByKey.has(k));
  if (flowing.length === 0) return [];
  return variants
    .filter((v) =>
      flowing.some(
        (k) =>
          fieldsByKey.get(k)?.inheritance === 'shared' ||
          !Object.prototype.hasOwnProperty.call(v.values, k),
      ),
    )
    .map((v) => v.id);
}
