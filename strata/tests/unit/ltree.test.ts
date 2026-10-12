/**
 * Path math.
 *
 * The hyphen encoding is the detail that breaks silently: an ltree label
 * matches `[A-Za-z0-9_]+` only, every uuid is full of hyphens, and a path
 * containing one is rejected by Postgres at write time rather than at the
 * point the mistake was made.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_HIERARCHY_DEPTH,
  ancestorIdsOf,
  assertNoCycle,
  buildPath,
  childPath,
  decodeLabel,
  encodeLabel,
  isAtOrBelow,
  parentPathOf,
  pathDepth,
  pathToIds,
  repointPath,
  selfIdOf,
} from '@/server/lib/ltree';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('label encoding', () => {
  it('replaces every hyphen with an underscore', () => {
    expect(encodeLabel(A)).toBe('11111111_1111_4111_8111_111111111111');
    expect(encodeLabel(A)).not.toContain('-');
  });

  it('round-trips', () => {
    expect(decodeLabel(encodeLabel(A))).toBe(A);
  });

  it('refuses a non-uuid rather than emitting an invalid label', () => {
    expect(() => encodeLabel('not-a-uuid')).toThrow();
    expect(() => encodeLabel("'; drop table items; --")).toThrow();
  });
});

describe('path construction', () => {
  it('builds a self-inclusive path', () => {
    const path = buildPath([A, B], C);
    expect(pathToIds(path)).toEqual([A, B, C]);
    expect(selfIdOf(path)).toBe(C);
    expect(ancestorIdsOf(path)).toEqual([A, B]);
    expect(pathDepth(path)).toBe(3);
  });

  it('a root path is just the item itself', () => {
    const path = childPath(null, A);
    expect(pathToIds(path)).toEqual([A]);
    expect(parentPathOf(path)).toBeNull();
  });

  it('rejects nesting past the depth limit', () => {
    const ids = Array.from({ length: MAX_HIERARCHY_DEPTH + 1 }, (_, i) => {
      const n = String(i).padStart(2, '0');
      return `${n}111111-1111-4111-8111-111111111111`;
    });
    expect(() => buildPath(ids.slice(0, -1), ids[ids.length - 1] as string)).toThrow(
      /limited to/i,
    );
  });
});

describe('containment', () => {
  it('treats a node as at-or-below itself', () => {
    const path = buildPath([A], B);
    expect(isAtOrBelow(path, path)).toBe(true);
  });

  it('matches descendants but not siblings with a shared prefix', () => {
    const parent = childPath(null, A);
    const child = childPath(parent, B);
    expect(isAtOrBelow(child, parent)).toBe(true);

    // The prefix trap: 'aa.bb' must not be considered below 'aa.b'.
    expect(isAtOrBelow('aa.bbb', 'aa.bb')).toBe(false);
  });
});

describe('cycle detection', () => {
  it('allows a move to an unrelated destination', () => {
    const moving = childPath(null, A);
    const destination = childPath(null, B);
    expect(() => assertNoCycle(moving, destination)).not.toThrow();
  });

  it('allows a move to the root', () => {
    expect(() => assertNoCycle(childPath(null, A), null)).not.toThrow();
  });

  it('rejects moving a subtree inside itself', () => {
    const moving = childPath(null, A);
    const ownChild = childPath(moving, B);
    expect(() => assertNoCycle(moving, ownChild)).toThrow(/own subtree/i);
  });

  it('rejects moving a node under itself', () => {
    const moving = childPath(null, A);
    expect(() => assertNoCycle(moving, moving)).toThrow();
  });
});

describe('repointPath', () => {
  it('rewrites only the ancestor prefix', () => {
    const oldRoot = childPath(null, A);
    const descendant = childPath(childPath(oldRoot, B), C);
    const newRoot = childPath(childPath(null, B), A);

    const moved = repointPath(descendant, oldRoot, newRoot);
    expect(pathToIds(moved)).toEqual([B, A, B, C]);
    expect(selfIdOf(moved)).toBe(C);
  });

  it('leaves paths outside the moving subtree untouched', () => {
    const oldRoot = childPath(null, A);
    const unrelated = childPath(null, B);
    expect(repointPath(unrelated, oldRoot, childPath(null, C))).toBe(unrelated);
  });
});
