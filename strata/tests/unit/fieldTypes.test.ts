/**
 * Field coercion.
 *
 * The cases below are what a spreadsheet paste actually contains. Each one that
 * fails is a cell the user has to retype by hand, and the whole premise of the
 * grid is that they should not have to.
 */

import { describe, expect, it } from 'vitest';
import { coerceValue, formatValue } from '@/server/validation/fieldTypes';
import type { SelectOption } from '@/types/fields';

const options: SelectOption[] = [
  { id: 'todo', label: 'To do', order: 0 },
  { id: 'in_progress', label: 'In progress', order: 1 },
  { id: 'done', label: 'Done', order: 2 },
];

function ok(result: ReturnType<typeof coerceValue>): unknown {
  if (!result.ok) throw new Error(`expected success, got: ${result.message}`);
  return result.value;
}

describe('number', () => {
  it('accepts thousands separators and currency symbols', () => {
    expect(ok(coerceValue('number', '1,250', {}))).toBe(1250);
    expect(ok(coerceValue('currency', '£1,250.00', { currencyCode: 'GBP' }))).toBe(1250);
    expect(ok(coerceValue('currency', '$1,250.50', { currencyCode: 'USD' }))).toBe(1250.5);
  });

  it('reads parenthesised negatives as accounting notation', () => {
    expect(ok(coerceValue('number', '(1,250)', {}))).toBe(-1250);
  });

  it('handles European decimal notation', () => {
    expect(ok(coerceValue('number', '1.234,56', {}))).toBe(1234.56);
  });

  it('distinguishes a thousands comma from a decimal comma', () => {
    expect(ok(coerceValue('number', '1,234', {}))).toBe(1234);
    expect(ok(coerceValue('number', '1,23', {}))).toBe(1.23);
  });

  it('accepts a percentage sign on a percent field', () => {
    expect(ok(coerceValue('percent', ' 45% ', {}))).toBe(45);
  });

  it('reports a message rather than throwing on nonsense', () => {
    const result = coerceValue('number', 'TBD', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('TBD');
      // The raw text is preserved so nothing the user typed is lost.
      expect(result.raw).toBe('TBD');
    }
  });

  it('enforces configured bounds', () => {
    expect(coerceValue('number', '-5', { min: 0 }).ok).toBe(false);
  });
});

describe('date', () => {
  it('accepts ISO', () => {
    expect(ok(coerceValue('date', '2026-03-14', {}))).toBe('2026-03-14');
  });

  it('accepts US slash format', () => {
    expect(ok(coerceValue('date', '3/14/2026', {}))).toBe('2026-03-14');
  });

  it('reads an unambiguous day-first date correctly', () => {
    // 14 cannot be a month, so this layout is unambiguous regardless of locale.
    expect(ok(coerceValue('date', '14/3/2026', {}))).toBe('2026-03-14');
  });

  it('reads dotted dates as European', () => {
    expect(ok(coerceValue('date', '14.03.2026', {}))).toBe('2026-03-14');
  });

  it('accepts an Excel serial number', () => {
    // Days since 1899-12-30 — the epoch that bakes in Excel's 1900 leap-year
    // bug, which is what the files it exports actually use.
    expect(ok(coerceValue('date', 46095, {}))).toBe('2026-03-14');
    expect(ok(coerceValue('date', 46096, {}))).toBe('2026-03-15');
  });

  it('rejects an impossible date rather than rolling it over', () => {
    // `new Date('2026-02-30')` silently becomes 2 March; that would write a
    // date the user never entered.
    expect(coerceValue('date', '2026-02-30', {}).ok).toBe(false);
  });
});

describe('checkbox', () => {
  it.each([
    ['TRUE', true],
    ['yes', true],
    ['Y', true],
    ['1', true],
    ['x', true],
    ['✓', true],
    ['no', false],
    ['FALSE', false],
    ['0', false],
  ])('reads %s as %s', (input, expected) => {
    expect(ok(coerceValue('checkbox', input, {}))).toBe(expected);
  });

  it('rejects a value that is neither', () => {
    expect(coerceValue('checkbox', 'maybe', {}).ok).toBe(false);
  });
});

describe('select', () => {
  it('matches by label, case-insensitively, and stores the id', () => {
    expect(ok(coerceValue('select', 'in progress', { options }))).toBe('in_progress');
    expect(ok(coerceValue('select', 'In Progress', { options }))).toBe('in_progress');
  });

  it('accepts the id directly', () => {
    expect(ok(coerceValue('select', 'done', { options }))).toBe('done');
  });

  it('lists the valid choices when it cannot match', () => {
    const result = coerceValue('select', 'Shipped', { options });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('To do');
  });

  it('formats back to the label, not the id', () => {
    expect(formatValue('select', 'in_progress', { options })).toBe('In progress');
  });
});

describe('multi_select', () => {
  it('splits on the separators spreadsheets emit', () => {
    expect(ok(coerceValue('multi_select', 'To do, Done', { options }))).toEqual(['todo', 'done']);
    expect(ok(coerceValue('multi_select', 'To do; Done', { options }))).toEqual(['todo', 'done']);
    expect(ok(coerceValue('multi_select', 'To do\nDone', { options }))).toEqual(['todo', 'done']);
  });

  it('names the values it could not match', () => {
    const result = coerceValue('multi_select', 'To do, Shipped', { options });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Shipped');
  });
});

describe('url', () => {
  it('assumes https for a bare domain', () => {
    expect(ok(coerceValue('url', 'example.com/path', {}))).toBe('https://example.com/path');
  });

  it('refuses a javascript: URL', () => {
    // A cell rendered as a link makes this a stored XSS.
    expect(coerceValue('url', 'javascript:alert(1)', {}).ok).toBe(false);
  });
});

describe('email', () => {
  it('extracts the address from a mail-client column', () => {
    expect(ok(coerceValue('email', 'Ada Lovelace <ada@example.com>', {}))).toBe(
      'ada@example.com',
    );
  });

  it('lowercases', () => {
    expect(ok(coerceValue('email', 'Ada@Example.COM', {}))).toBe('ada@example.com');
  });
});

describe('user', () => {
  it('resolves an email against workspace members', () => {
    const ctx = { usersByEmail: new Map([['ada@example.com', 'user-1']]) };
    expect(ok(coerceValue('user', 'ada@example.com', {}, ctx))).toBe('user-1');
  });

  it('refuses an unknown person rather than storing a dangling id', () => {
    const ctx = { usersByEmail: new Map<string, string>() };
    expect(coerceValue('user', 'nobody@example.com', {}, ctx).ok).toBe(false);
  });
});

describe('blank handling', () => {
  it.each(['', '  ', '-', 'n/a', 'N/A', 'null'])('treats %s as empty', (input) => {
    expect(ok(coerceValue('text', input, {}))).toBeNull();
  });
});
