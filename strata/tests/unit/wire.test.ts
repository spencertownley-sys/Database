/**
 * The wire boundary — API Design §1.2.
 *
 * Two invariants worth pinning: conversion is symmetric for system keys, and
 * user-keyed bags (`values`, `config`, …) pass through byte-identical. The
 * second is the one that destroys customer data if it regresses — a field key
 * is the customer's identifier, not a name we style.
 */

import { describe, expect, it } from 'vitest';
import { fromWire, toWire } from '@/lib/wire';

describe('toWire', () => {
  it('snake_cases system keys recursively', () => {
    expect(
      toWire({ itemTypeId: 'x', missingRequired: ['a'], nested: { completenessPct: 78 } }),
    ).toEqual({ item_type_id: 'x', missing_required: ['a'], nested: { completeness_pct: 78 } });
  });

  it('never touches keys inside value bags', () => {
    const bag = { myField: 1, 'weird Key': 2, alreadySnake_case: 3, nested: { innerCamel: 4 } };
    const out = toWire({ effectiveValues: bag }) as { effective_values: unknown };
    expect(out.effective_values).toEqual(bag);
  });

  it('never touches select-option config', () => {
    const config = { options: [{ id: 'opt_a', label: 'A' }], currencyCode: 'GBP' };
    const out = toWire({ config }) as { config: unknown };
    expect(out.config).toEqual(config);
  });

  it('serialises dates to RFC 3339, including inside preserved bags', () => {
    const d = new Date('2026-08-15T14:30:00Z');
    expect(toWire({ createdAt: d })).toEqual({ created_at: '2026-08-15T14:30:00.000Z' });
    expect(toWire({ values: { when: d } })).toEqual({
      values: { when: '2026-08-15T14:30:00.000Z' },
    });
  });

  it('walks the before/after snapshots but preserves their nested values', () => {
    const out = toWire({
      before: { parentId: 'p', values: { customKey: 1 } },
    }) as { before: { parent_id: string; values: Record<string, unknown> } };
    expect(out.before.parent_id).toBe('p');
    expect(out.before.values).toEqual({ customKey: 1 });
  });
});

describe('fromWire', () => {
  it('camelCases request bodies, preserving patch value bags', () => {
    const body = {
      item_type_id: 'x',
      target: { kind: 'ids', item_ids: ['a'] },
      patch: { values: { budget_gbp: 42 }, field_keys: ['budget_gbp'] },
    };
    expect(fromWire(body)).toEqual({
      itemTypeId: 'x',
      target: { kind: 'ids', itemIds: ['a'] },
      patch: { values: { budget_gbp: 42 }, fieldKeys: ['budget_gbp'] },
    });
  });

  it('round-trips system-keyed objects', () => {
    const obj = { itemTypeId: 'x', treeNodeIds: ['a'], isVariantModel: false };
    expect(fromWire(toWire(obj))).toEqual(obj);
  });

  it('leaves the §4.1 filter grammar untouched — its keys are single words', () => {
    const filter = {
      op: 'and',
      children: [{ field: 'status', operator: 'in', value: ['active'] }],
    };
    expect(fromWire(filter)).toEqual(filter);
    expect(toWire(filter)).toEqual(filter);
  });
});
