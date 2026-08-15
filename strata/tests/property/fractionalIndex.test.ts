/**
 * Fractional index ordering.
 *
 * The property that matters is simple to state and easy to break: for any
 * sequence of insertions at arbitrary positions, the generated keys must sort
 * into exactly the order the insertions implied. A subtle break here reorders
 * a user's carefully arranged rows on the next drag, with no error anywhere.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  appendKeys,
  assertValidKey,
  firstKey,
  keyBetween,
  keysBetween,
} from '@/server/lib/fractionalIndex';

describe('keyBetween', () => {
  it('produces a key strictly between its neighbours', () => {
    const a = keyBetween(null, null);
    const b = keyBetween(a, null);
    const mid = keyBetween(a, b);
    expect(a < mid).toBe(true);
    expect(mid < b).toBe(true);
  });

  it('prepends before the first key', () => {
    const first = firstKey();
    const before = keyBetween(null, first);
    expect(before < first).toBe(true);
  });

  it('never emits a key ending in the zero digit', () => {
    // The invariant the midpoint algorithm depends on: a trailing zero has no
    // representable key below it, so the next insert before that row fails.
    let cursor: string | null = null;
    for (let i = 0; i < 200; i += 1) {
      cursor = keyBetween(null, cursor);
      expect(cursor.endsWith('0')).toBe(false);
      assertValidKey(cursor);
    }
  });

  it('rejects out-of-order neighbours rather than emitting a bad key', () => {
    const a = firstKey();
    const b = keyBetween(a, null);
    expect(() => keyBetween(b, a)).toThrow();
  });
});

describe('keysBetween', () => {
  it('returns n ascending keys inside the bounds', () => {
    const lower = firstKey();
    const upper = keyBetween(lower, null);
    const keys = keysBetween(lower, upper, 25);

    expect(keys).toHaveLength(25);
    expect([...keys].sort()).toEqual(keys);
    expect(lower < (keys[0] as string)).toBe(true);
    expect((keys[keys.length - 1] as string) < upper).toBe(true);
  });

  it('stays short under bulk insertion', () => {
    // Chaining keyBetween off each previous result grows one character per
    // call, which turns a 500-row paste into 500-character order keys.
    const keys = keysBetween(null, null, 500);
    const longest = Math.max(...keys.map((k) => k.length));
    expect(longest).toBeLessThan(16);
  });
});

describe('ordering properties', () => {
  it('preserves insertion order for arbitrary interleaved inserts', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 40 }), { minLength: 1, maxLength: 40 }),
        (positions) => {
          // Model the list as an array of keys; insert at each position and
          // assert the keys stay sorted in list order throughout.
          const list: string[] = [firstKey()];

          for (const raw of positions) {
            const at = raw % (list.length + 1);
            const before = at === 0 ? null : (list[at - 1] as string);
            const after = at === list.length ? null : (list[at] as string);
            const key = keyBetween(before, after);
            list.splice(at, 0, key);
          }

          for (let i = 1; i < list.length; i += 1) {
            if (!((list[i - 1] as string) < (list[i] as string))) return false;
          }
          return true;
        },
      ),
      { numRuns: 300 },
    );
  });

  it('appendKeys produces a strictly ascending run after any existing key', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (count) => {
        const existing = appendKeys(null, 3);
        const last = existing[existing.length - 1] as string;
        const appended = appendKeys(last, count);

        if (appended.length !== count) return false;
        if (!(last < (appended[0] as string))) return false;
        for (let i = 1; i < appended.length; i += 1) {
          if (!((appended[i - 1] as string) < (appended[i] as string))) return false;
        }
        return true;
      }),
      { numRuns: 100 },
    );
  });
});
