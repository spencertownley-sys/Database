/**
 * Variant resolution property tests — the 🔒 launch-checklist item: "variant
 * resolution property tests pass across arbitrary model/variant/override
 * combinations."
 *
 * Rather than asserting outcomes for hand-picked cases, these state the §2.5
 * invariants that must hold for *any* combination of model values, variant
 * values, inheritance modes, and axis declarations. A regression in the
 * resolution order, the override test, or the axis pass fails one of these
 * before it ships as a wrong price on somebody's variant.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { computeEffectiveValues, revertOverride } from '@/server/services/variants.service';

const keyArb = fc.constantFrom('alpha', 'beta', 'gamma', 'delta', 'epsilon');

const fieldArb = fc.record({
  key: keyArb,
  inheritance: fc.constantFrom('shared' as const, 'variant' as const),
});

/** Distinct-by-key field lists, with a subset of keys declared as axes. */
const schemaArb = fc
  .uniqueArray(fieldArb, { minLength: 1, maxLength: 5, selector: (f) => f.key })
  .chain((fields) =>
    fc.record({
      fields: fc.constant(fields),
      axes: fc.subarray(fields.map((f) => f.key)),
    }),
  );

const valueArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
);

const valuesArb = fc.dictionary(keyArb, valueArb, { maxKeys: 5 });

describe('computeEffectiveValues invariants', () => {
  it('every resolved value is traceable to exactly the source §2.5 names', () => {
    fc.assert(
      fc.property(schemaArb, valuesArb, valuesArb, ({ fields, axes }, model, variant) => {
        const { values } = computeEffectiveValues(model, variant, fields, axes);
        const axisKeys = new Set(axes);

        for (const field of fields) {
          const resolved = values[field.key];
          if (axisKeys.has(field.key)) {
            // Axis: the variant's own value, or absent.
            if (resolved !== undefined) expect(resolved).toBe(variant[field.key]);
            else expect(variant[field.key] ?? null).toBeNull();
          } else if (field.inheritance === 'shared') {
            // Shared: only ever the model's value.
            if (resolved !== undefined) expect(resolved).toBe(model[field.key]);
            else expect(model[field.key] ?? null).toBeNull();
          } else {
            // Variant: own value when the key is present, else the model's.
            const overridden =
              Object.prototype.hasOwnProperty.call(variant, field.key) &&
              variant[field.key] !== undefined &&
              variant[field.key] !== null;
            if (overridden) expect(resolved).toBe(variant[field.key]);
            else if (resolved !== undefined) expect(resolved).toBe(model[field.key]);
          }
        }
      }),
    );
  });

  it('never emits a key outside the schema, and never an explicit null', () => {
    fc.assert(
      fc.property(schemaArb, valuesArb, valuesArb, ({ fields, axes }, model, variant) => {
        const { values } = computeEffectiveValues(model, variant, fields, axes);
        const known = new Set<string>([...fields.map((f) => f.key), ...axes]);
        for (const [key, value] of Object.entries(values)) {
          expect(known.has(key)).toBe(true);
          expect(value).not.toBeNull();
          expect(value).not.toBeUndefined();
        }
      }),
    );
  });

  it('is deterministic — same inputs, same resolution', () => {
    fc.assert(
      fc.property(schemaArb, valuesArb, valuesArb, ({ fields, axes }, model, variant) => {
        const a = computeEffectiveValues(model, variant, fields, axes);
        const b = computeEffectiveValues(model, variant, fields, axes);
        expect(a).toEqual(b);
      }),
    );
  });

  it('override-then-revert restores the inherited resolution exactly', () => {
    fc.assert(
      fc.property(
        schemaArb,
        valuesArb,
        valuesArb,
        fc.string({ minLength: 1 }),
        ({ fields, axes }, model, variant, override) => {
          const axisKeys = new Set(axes);
          const target = fields.find(
            (f) => f.inheritance === 'variant' && !axisKeys.has(f.key),
          );
          fc.pre(target !== undefined);
          const key = (target as { key: string }).key;

          const base = { ...variant };
          delete base[key];

          const before = computeEffectiveValues(model, base, fields, axes);
          const withOverride = computeEffectiveValues(
            model,
            { ...base, [key]: override },
            fields,
            axes,
          );
          expect(withOverride.values[key]).toBe(override);

          const after = computeEffectiveValues(
            model,
            revertOverride({ ...base, [key]: override }, key),
            fields,
            axes,
          );
          expect(after).toEqual(before);
        },
      ),
    );
  });

  it('a shared field cannot be moved by any variant-side write', () => {
    fc.assert(
      fc.property(schemaArb, valuesArb, valuesArb, valuesArb, ({ fields, axes }, model, a, b) => {
        const axisKeys = new Set(axes);
        const resolvedA = computeEffectiveValues(model, a, fields, axes).values;
        const resolvedB = computeEffectiveValues(model, b, fields, axes).values;
        for (const field of fields) {
          if (field.inheritance !== 'shared' || axisKeys.has(field.key)) continue;
          expect(resolvedA[field.key]).toEqual(resolvedB[field.key]);
        }
      }),
    );
  });
});
