/**
 * Completeness: "how much of this item is actually filled in".
 *
 * Computed from `effective_values`, never from `values`, so a variant that
 * inherits a filled-in description from its model reads as complete. Computing
 * it from own values would make every freshly generated variant look 20%
 * complete and make the metric useless on exactly the data model the product
 * exists for.
 *
 * Recomputed inside every change-set commit rather than on read: it is
 * filtered and sorted on ("show me incomplete campaigns"), and a computed
 * column cannot be indexed usefully at 100k items.
 */

import type { Field } from '@/server/db/schema/itemTypes';
import type { InvalidValues, ItemValues } from '@/server/db/schema/items';
import { handlerFor } from '@/server/validation/fieldTypes';

export interface CompletenessInput {
  effectiveValues: ItemValues;
  fields: readonly Pick<
    Field,
    'key' | 'type' | 'required' | 'countsTowardCompleteness' | 'config'
  >[];
  /** A field whose stored value failed coercion is not filled in. */
  invalidValues?: InvalidValues;
  /** Non-empty titles count toward completeness; an untitled item is not done. */
  title?: string;
}

export interface CompletenessResult {
  /** 0–100, integer. */
  pct: number;
  /** Keys of required fields that are empty, in field order. */
  missingRequired: string[];
  /** Every counted field that is empty, required or not. Powers the detail panel. */
  missingOptional: string[];
  countedFields: number;
  filledFields: number;
}

export function computeCompleteness(input: CompletenessInput): CompletenessResult {
  const { effectiveValues, fields, invalidValues = {}, title } = input;

  const missingRequired: string[] = [];
  const missingOptional: string[] = [];
  let counted = 0;
  let filled = 0;

  // The title is a field in every practical sense — it is required, it shows
  // in every view, and an item without one is not finished.
  if (title !== undefined) {
    counted += 1;
    if (title.trim().length > 0) filled += 1;
    else missingRequired.push('$title');
  }

  for (const field of fields) {
    const value = effectiveValues[field.key];
    const isInvalid = Object.prototype.hasOwnProperty.call(invalidValues, field.key);
    const empty = isInvalid || handlerFor(field.type).isEmpty(value);

    if (field.required) {
      counted += 1;
      if (empty) missingRequired.push(field.key);
      else filled += 1;
      continue;
    }

    if (!field.countsTowardCompleteness) continue;

    counted += 1;
    if (empty) missingOptional.push(field.key);
    else filled += 1;
  }

  // An Item Type with nothing to fill in is complete, not divide-by-zero.
  const pct = counted === 0 ? 100 : Math.round((filled / counted) * 100);

  return { pct, missingRequired, missingOptional, countedFields: counted, filledFields: filled };
}

/**
 * Aggregate for a group header or tree node: the mean of member percentages,
 * not the ratio of complete items. "62% complete" over a group where every
 * item is 62% done is more useful than "0 of 40 items complete".
 */
export function averageCompleteness(percentages: readonly number[]): number {
  if (percentages.length === 0) return 0;
  const total = percentages.reduce((sum, p) => sum + p, 0);
  return Math.round(total / percentages.length);
}

/**
 * Whether adding a required field to an Item Type already in use needs an
 * explicit acknowledgement.
 *
 * Adding one silently drops every existing item's completeness overnight, and
 * a metric that moves for reasons the user did not cause is a metric they stop
 * trusting. The caller must either supply a default value or pass an explicit
 * acknowledgement — see `fields.service.ts`.
 */
export function requiredFieldNeedsAcknowledgement(
  existingItemCount: number,
  hasDefaultValue: boolean,
): boolean {
  return existingItemCount > 0 && !hasDefaultValue;
}
