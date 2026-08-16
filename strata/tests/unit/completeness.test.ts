/**
 * Completeness — PRD §4.7: filled required fields ÷ total required fields.
 *
 * The denominator is the part that regressed once already (see
 * docs/SPEC_RECONCILIATION.md §1.2): optional fields and the title must not
 * appear in it. Completeness is filterable, sortable, and aggregated per
 * group, so a wrong denominator shifts a number the whole product is
 * organised around.
 */

import { describe, expect, it } from 'vitest';
import {
  averageCompleteness,
  computeCompleteness,
  requiredFieldNeedsAcknowledgement,
} from '@/server/services/completeness.service';

const field = (
  key: string,
  requiredForCompleteness: boolean,
  type: 'text' | 'number' | 'checkbox' = 'text',
) => ({ key, type, requiredForCompleteness, config: {} });

describe('computeCompleteness', () => {
  it('counts required fields only — optional fields never enter the denominator', () => {
    const result = computeCompleteness({
      effectiveValues: { a: 'filled' },
      fields: [
        field('a', true),
        field('opt1', false), // empty and optional: must not drag the pct down
        field('opt2', false),
        field('opt3', false),
      ],
    });
    expect(result.pct).toBe(100);
    expect(result.requiredFields).toBe(1);
  });

  it('is filled-required over total-required', () => {
    const result = computeCompleteness({
      effectiveValues: { a: 'x', b: 42 },
      fields: [field('a', true), field('b', true, 'number'), field('c', true), field('d', true)],
    });
    expect(result.pct).toBe(50);
    expect(result.missingRequired).toEqual(['c', 'd']);
  });

  it('does not count the title', () => {
    // An untitled item with every required field filled is 100% complete —
    // the title is not part of the PRD formula.
    const result = computeCompleteness({
      effectiveValues: { a: 'x' },
      fields: [field('a', true)],
    });
    expect(result.pct).toBe(100);
    expect(result.missingRequired).toEqual([]);
  });

  it('a type with no required fields is complete, not divide-by-zero', () => {
    const result = computeCompleteness({
      effectiveValues: {},
      fields: [field('opt', false)],
    });
    expect(result.pct).toBe(100);
    expect(result.requiredFields).toBe(0);
  });

  it('an invalid stored value is not filled, even though a value exists', () => {
    const result = computeCompleteness({
      effectiveValues: { a: 'TBD' },
      fields: [field('a', true)],
      invalidValues: { a: { raw: 'TBD', message: 'Expected a number', at: '2026-08-15' } },
    });
    expect(result.pct).toBe(0);
    expect(result.missingRequired).toEqual(['a']);
  });

  it('unchecked checkboxes count as filled — false is an answer', () => {
    const result = computeCompleteness({
      effectiveValues: { done: false },
      fields: [field('done', true, 'checkbox')],
    });
    expect(result.pct).toBe(100);
  });

  it('missingRequired preserves field order for the detail panel', () => {
    const result = computeCompleteness({
      effectiveValues: {},
      fields: [field('z_first', true), field('a_second', true)],
    });
    expect(result.missingRequired).toEqual(['z_first', 'a_second']);
  });
});

describe('averageCompleteness', () => {
  it('is the mean of member percentages', () => {
    expect(averageCompleteness([100, 50, 0])).toBe(50);
    expect(averageCompleteness([])).toBe(0);
  });
});

describe('requiredFieldNeedsAcknowledgement', () => {
  it('needs acknowledgement only when items exist and no default is supplied', () => {
    expect(requiredFieldNeedsAcknowledgement(10, false)).toBe(true);
    expect(requiredFieldNeedsAcknowledgement(10, true)).toBe(false);
    expect(requiredFieldNeedsAcknowledgement(0, false)).toBe(false);
  });
});
