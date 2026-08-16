/**
 * Variant resolution — Tech Spec §2.5, tested arm by arm.
 *
 * The semantics here were inverted once already (see
 * docs/SPEC_RECONCILIATION.md §1.1), so these tests spell out each rule in the
 * spec's own vocabulary rather than asserting round numbers:
 *
 *   shared   → always the model's value, read-only on the variant
 *   variant  → the variant's own value when the key is present, else the model's
 *   axis     → always the variant's own value, whatever the inheritance says
 */

import { describe, expect, it } from 'vitest';
import {
  computeEffectiveValues,
  isInherited,
  planVariantCoordinates,
  revertOverride,
  variantsAffectedByModelChange,
} from '@/server/services/variants.service';

const FIELDS = [
  { key: 'tagline', inheritance: 'shared' as const },
  { key: 'budget', inheritance: 'variant' as const },
  { key: 'region', inheritance: 'variant' as const },
];
const AXES = ['region'];

describe('computeEffectiveValues — the shared arm', () => {
  it('always resolves to the model value', () => {
    const { values, inheritedKeys } = computeEffectiveValues(
      { tagline: 'Build Better' },
      {},
      FIELDS,
      AXES,
    );
    expect(values.tagline).toBe('Build Better');
    expect(inheritedKeys).toContain('tagline');
  });

  it('ignores a stray variant-side copy — shared means shared', () => {
    const { values, overriddenKeys } = computeEffectiveValues(
      { tagline: 'Build Better' },
      { tagline: 'Local Slogan' },
      FIELDS,
      AXES,
    );
    expect(values.tagline).toBe('Build Better');
    expect(overriddenKeys).not.toContain('tagline');
  });

  it('resolves to empty when the model has no value', () => {
    const { values } = computeEffectiveValues({}, { tagline: 'Orphaned' }, FIELDS, AXES);
    expect(values).not.toHaveProperty('tagline');
  });
});

describe('computeEffectiveValues — the variant arm', () => {
  it('inherits the model value when the variant has none', () => {
    const { values, inheritedKeys } = computeEffectiveValues({ budget: 40000 }, {}, FIELDS, AXES);
    expect(values.budget).toBe(40000);
    expect(inheritedKeys).toContain('budget');
  });

  it('key presence is the override', () => {
    const { values, overriddenKeys } = computeEffectiveValues(
      { budget: 40000 },
      { budget: 52000 },
      FIELDS,
      AXES,
    );
    expect(values.budget).toBe(52000);
    expect(overriddenKeys).toEqual(['budget']);
  });

  it('deleting the key reverts to inherited', () => {
    const reverted = revertOverride({ budget: 52000, region: 'emea' }, 'budget');
    const { values, inheritedKeys } = computeEffectiveValues(
      { budget: 40000 },
      reverted,
      FIELDS,
      AXES,
    );
    expect(values.budget).toBe(40000);
    expect(inheritedKeys).toContain('budget');
  });
});

describe('computeEffectiveValues — the axis pass', () => {
  it('an axis value is always the variant own value', () => {
    const { values } = computeEffectiveValues(
      { region: 'model-region-should-never-show' },
      { region: 'emea' },
      FIELDS,
      AXES,
    );
    expect(values.region).toBe('emea');
  });

  it('an axis value never falls back to the model', () => {
    const { values } = computeEffectiveValues(
      { region: 'model-region-should-never-show' },
      {},
      FIELDS,
      AXES,
    );
    expect(values).not.toHaveProperty('region');
  });

  it('the axis pass wins even for a shared-inheritance axis field', () => {
    const fields = [{ key: 'region', inheritance: 'shared' as const }];
    const { values } = computeEffectiveValues(
      { region: 'model-region' },
      { region: 'apac' },
      fields,
      ['region'],
    );
    expect(values.region).toBe('apac');
  });
});

describe('isInherited', () => {
  it('shared fields are always inherited on a variant', () => {
    expect(isInherited('tagline', { tagline: 'stray' }, { inheritance: 'shared' }, AXES)).toBe(true);
  });

  it('variant fields are inherited only while the key is absent', () => {
    expect(isInherited('budget', {}, { inheritance: 'variant' }, AXES)).toBe(true);
    expect(isInherited('budget', { budget: 1 }, { inheritance: 'variant' }, AXES)).toBe(false);
  });

  it('axis values are never inherited', () => {
    expect(isInherited('region', {}, { inheritance: 'variant' }, AXES)).toBe(false);
  });
});

describe('variantsAffectedByModelChange', () => {
  const byKey = new Map(FIELDS.map((f) => [f.key, f]));
  const variants = [
    { id: 'inherits-everything', values: {} },
    { id: 'overrides-budget', values: { budget: 52000 } },
  ];

  it('a shared change reaches every variant — overrides are impossible', () => {
    expect(variantsAffectedByModelChange(['tagline'], byKey, variants, AXES)).toEqual([
      'inherits-everything',
      'overrides-budget',
    ]);
  });

  it('a variant-inheritance change skips variants that override it', () => {
    expect(variantsAffectedByModelChange(['budget'], byKey, variants, AXES)).toEqual([
      'inherits-everything',
    ]);
  });

  it('an axis change reaches nobody', () => {
    expect(variantsAffectedByModelChange(['region'], byKey, variants, AXES)).toEqual([]);
  });

  it('a change to an unknown key reaches nobody', () => {
    expect(variantsAffectedByModelChange(['ghost'], byKey, variants, AXES)).toEqual([]);
  });
});

describe('planVariantCoordinates', () => {
  const model = { title: 'Q3 Launch', parentId: null, variantParentId: null };
  const manyOptions = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `o${i}`, label: `Option ${i}`, order: i }));
  const axisField = (key: string, count: number) => ({
    key,
    type: 'select' as const,
    config: { options: manyOptions(count) },
  });

  it('expands the full grid, titles rows with option labels', () => {
    const plan = planVariantCoordinates({
      model,
      variantAxes: ['region', 'size'],
      fields: [axisField('region', 3), axisField('size', 2)],
      axisValues: { region: ['o0', 'o1'], size: ['o0'] },
      existingCoordinates: [],
    });
    expect(plan.coordinates).toHaveLength(2);
    expect(plan.titles[0]).toBe('Q3 Launch (Option 0 · Option 0)');
  });

  it('enforces the 200-variant cap counting what already exists', () => {
    const existing = Array.from({ length: 150 }, (_, i) => ({ region: `o${i}`, size: 'o0' }));
    expect(() =>
      planVariantCoordinates({
        model,
        variantAxes: ['region', 'size'],
        fields: [axisField('region', 60), axisField('size', 2)],
        // 60×2 = 120 new combos on top of 150 existing → over 200.
        axisValues: { region: manyOptions(60).map((o) => o.id), size: ['o0', 'o1'] },
        existingCoordinates: existing,
      }),
    ).toThrowError(/limit is 200/);
  });

  it('demands a value on every declared axis', () => {
    expect(() =>
      planVariantCoordinates({
        model,
        variantAxes: ['region', 'size'],
        fields: [axisField('region', 3), axisField('size', 2)],
        axisValues: { region: ['o0'] },
        existingCoordinates: [],
      }),
    ).toThrowError(/every axis needs a value/);
  });

  it('refuses when every combination already exists', () => {
    expect(() =>
      planVariantCoordinates({
        model,
        variantAxes: ['region'],
        fields: [axisField('region', 3)],
        axisValues: { region: ['o0'] },
        existingCoordinates: [{ region: 'o0' }],
      }),
    ).toThrowError(/already exists/);
  });

  it('skips archived options', () => {
    expect(() =>
      planVariantCoordinates({
        model,
        variantAxes: ['region'],
        fields: [
          {
            key: 'region',
            type: 'select' as const,
            config: { options: [{ id: 'gone', label: 'Gone', order: 0, archived: true }] },
          },
        ],
        axisValues: { region: ['gone'] },
        existingCoordinates: [],
      }),
    ).toThrowError(/not an option/);
  });
});
