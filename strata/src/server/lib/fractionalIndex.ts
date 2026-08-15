/**
 * Fractional indexing for sibling order.
 *
 * Approach: an item's position among its siblings is a *string* key ordered
 * lexicographically, not an integer. Dragging a row between two neighbours
 * mints a new key strictly between theirs, so a reorder writes exactly one
 * row instead of renumbering the whole sibling list.
 *
 * What breaks if you change this naively:
 *
 *  - **Integer positions look simpler and are not.** Reordering 400 siblings
 *    with integer positions rewrites 400 rows inside a change set, which
 *    turns one drag into a 400-entry undo record.
 *  - **Keys must never end in the zero digit.** The midpoint algorithm relies
 *    on it: a trailing zero has no representable key below it, so the next
 *    insert before that row cannot generate a key. Every function here
 *    preserves the invariant; `assertValidKey` enforces it at the boundary.
 *  - **Keys are opaque.** Never parse one, sort by anything but the raw
 *    string, or assume a length. Two concurrent inserts at the same slot can
 *    produce equal keys; `(order_key, id)` is the real sort tuple everywhere.
 */

import { AppError } from './errors';

/**
 * Base-62 in ASCII order: digits, then uppercase, then lowercase. The
 * alphabet must be sorted by codepoint or lexicographic comparison in
 * Postgres (C collation) and in JS will disagree.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const ZERO = DIGITS[0] as string;
const KEY_RE = /^[0-9A-Za-z]+$/;

function digitAt(s: string, i: number): string | undefined {
  return s[i];
}

function indexOfDigit(c: string): number {
  const i = DIGITS.indexOf(c);
  if (i === -1) throw new AppError('INTERNAL', `Invalid order key digit: ${JSON.stringify(c)}`);
  return i;
}

export function assertValidKey(key: string, label = 'order key'): void {
  if (!KEY_RE.test(key)) {
    throw new AppError('INTERNAL', `Invalid ${label}: ${JSON.stringify(key)}`);
  }
  if (key.endsWith(ZERO)) {
    throw new AppError('INTERNAL', `Invalid ${label}: must not end in "${ZERO}".`);
  }
}

/**
 * The shortest string strictly between `a` and `b`.
 *
 * `a` is exclusive-lower ('' means unbounded below); `b` is exclusive-upper
 * (null means unbounded above).
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) {
    throw new AppError('INTERNAL', `Order keys out of sequence: ${a} >= ${b}`);
  }
  if (a.endsWith(ZERO) || (b !== null && b.endsWith(ZERO))) {
    throw new AppError('INTERNAL', 'Order key must not end in the zero digit.');
  }

  if (b !== null) {
    // Strip the longest common prefix and recurse on the remainder, so
    // 'a1'/'a3' becomes 'a' + midpoint('1','3').
    let n = 0;
    while ((digitAt(a, n) ?? ZERO) === digitAt(b, n)) n += 1;
    if (n > 0) return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
  }

  const headA = digitAt(a, 0);
  const headB = b !== null ? digitAt(b, 0) : undefined;
  const digitA = headA !== undefined ? indexOfDigit(headA) : 0;
  const digitB = headB !== undefined ? indexOfDigit(headB) : DIGITS.length;

  if (digitB - digitA > 1) {
    // There is room for a digit strictly between them.
    const mid = Math.round(0.5 * (digitA + digitB));
    return DIGITS[mid] as string;
  }

  // The head digits are adjacent, so the answer must be longer than one digit.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return (DIGITS[digitA] as string) + midpoint(a.slice(1), null);
}

/**
 * Mints a key ordered strictly between `before` and `after`.
 *
 * Pass `null` for either end: `keyBetween(null, first)` prepends,
 * `keyBetween(last, null)` appends, `keyBetween(null, null)` starts a list.
 */
export function keyBetween(before: string | null, after: string | null): string {
  if (before !== null) assertValidKey(before, 'preceding order key');
  if (after !== null) assertValidKey(after, 'following order key');
  if (before !== null && after !== null && before >= after) {
    throw new AppError(
      'CONFLICT',
      'Sibling order is inconsistent — reload the view and try the move again.',
    );
  }
  return midpoint(before ?? '', after);
}

/** `n` keys in ascending order, all strictly between `before` and `after`. */
export function keysBetween(before: string | null, after: string | null, n: number): string[] {
  if (n <= 0) return [];
  if (n === 1) return [keyBetween(before, after)];

  // Bisect rather than chaining `keyBetween` off the previous result: chaining
  // grows one key per call and produces pathologically long keys for a bulk
  // insert of a few hundred siblings.
  const mid = Math.floor(n / 2);
  const midKey = keyBetween(before, after);
  return [
    ...keysBetween(before, midKey, mid),
    midKey,
    ...keysBetween(midKey, after, n - mid - 1),
  ];
}

/** The first key in an empty list. */
export function firstKey(): string {
  return keyBetween(null, null);
}

/** Convenience for appending `n` items to the end of an existing list. */
export function appendKeys(lastKey: string | null, n: number): string[] {
  const out: string[] = [];
  let cursor = lastKey;
  for (let i = 0; i < n; i += 1) {
    cursor = keyBetween(cursor, null);
    out.push(cursor);
  }
  return out;
}
