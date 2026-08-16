/**
 * Path math for both hierarchies (items.path and tree_nodes.path).
 *
 * Approach: a materialized ltree path of ancestor ids, self-inclusive. The
 * root item `A` has path `A`; its child `B` has path `A.B`. Self-inclusive
 * paths let a subtree be selected with a single indexed operator
 * (`path <@ :ancestorPath`) with no recursive CTE and no depth column.
 *
 * What breaks if you change this naively:
 *
 *  1. **ltree labels cannot contain hyphens.** A label matches `[A-Za-z0-9_]+`
 *     only, and every UUID is full of hyphens. Every id is therefore encoded
 *     hyphen→underscore on the way in and decoded on the way out. Nothing
 *     outside this module may build an ltree literal; hand-rolling the
 *     encoding elsewhere is how half the codebase ends up with paths that
 *     silently fail to match.
 *
 *  2. **Paths are self-inclusive.** Making them ancestor-only would make
 *     `path <@ x` exclude the row itself and quietly break every
 *     include-descendants filter.
 *
 *  3. **Reparenting is a string splice, not a recompute.** Moving a subtree
 *     replaces the ancestor prefix on every descendant in one UPDATE. Walking
 *     children in application code is O(n) round trips and loses atomicity.
 */

import { AppError } from './errors';

/** ltree in Postgres 16 caps a label at 1000 bytes; an encoded uuid is 36. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LABEL_RE = /^[0-9a-zA-Z_]+$/;

/**
 * Postgres ltree tops out at 65535 labels, but a work hierarchy that deep is a
 * data-entry accident, not a use case. Rejecting early keeps error messages
 * comprehensible and keeps path strings bounded for the index.
 */
export const MAX_HIERARCHY_DEPTH = 32;

export function encodeLabel(id: string): string {
  if (!UUID_RE.test(id)) {
    throw new AppError('INTERNAL_ERROR', `Cannot encode "${id}" as an ltree label: not a uuid.`);
  }
  return id.replaceAll('-', '_');
}

export function decodeLabel(label: string): string {
  if (!LABEL_RE.test(label)) {
    throw new AppError('INTERNAL_ERROR', `Cannot decode "${label}": not a valid ltree label.`);
  }
  return label.replaceAll('_', '-');
}

/** Builds a self-inclusive path from an ordered ancestor chain plus self. */
export function buildPath(ancestorIds: readonly string[], selfId: string): string {
  const labels = [...ancestorIds, selfId].map(encodeLabel);
  if (labels.length > MAX_HIERARCHY_DEPTH) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Nesting is limited to ${MAX_HIERARCHY_DEPTH} levels; this would be ${labels.length}.`,
    );
  }
  return labels.join('.');
}

/** Appends a child id to a parent's path. `null` parent → a root path. */
export function childPath(parentPath: string | null, childId: string): string {
  const label = encodeLabel(childId);
  if (!parentPath) return label;
  const depth = pathDepth(parentPath) + 1;
  if (depth > MAX_HIERARCHY_DEPTH) {
    throw new AppError(
      'VALIDATION_ERROR',
      `Nesting is limited to ${MAX_HIERARCHY_DEPTH} levels; this would be ${depth}.`,
    );
  }
  return `${parentPath}.${label}`;
}

export function pathToIds(path: string): string[] {
  if (!path) return [];
  return path.split('.').map(decodeLabel);
}

export function pathDepth(path: string): number {
  if (!path) return 0;
  return path.split('.').length;
}

/** The id of the row the path belongs to (the last label). */
export function selfIdOf(path: string): string {
  const labels = path.split('.');
  const last = labels[labels.length - 1];
  if (!last) throw new AppError('INTERNAL_ERROR', `Empty ltree path.`);
  return decodeLabel(last);
}

/** The parent's path, or null when the row is a root. */
export function parentPathOf(path: string): string | null {
  const idx = path.lastIndexOf('.');
  return idx === -1 ? null : path.slice(0, idx);
}

export function ancestorIdsOf(path: string): string[] {
  const ids = pathToIds(path);
  return ids.slice(0, -1);
}

/**
 * True when `candidate` is at or below `ancestor` — the JS mirror of the
 * Postgres `<@` operator, used for pre-flight cycle checks so we can return a
 * typed error instead of relying on a constraint violation.
 */
export function isAtOrBelow(candidate: string, ancestor: string): boolean {
  return candidate === ancestor || candidate.startsWith(`${ancestor}.`);
}

/**
 * Rejects a move that would make a subtree its own ancestor.
 *
 * The check that matters is the one people forget: it is not enough that the
 * new parent differs from the node — the new parent must not be *inside* the
 * subtree being moved. Reparenting "Campaign" under its own "Q3 Launch" child
 * produces a cycle that ltree cannot represent and that a recursive read will
 * spin on forever.
 */
export function assertNoCycle(movingPath: string, newParentPath: string | null): void {
  if (newParentPath === null) return;
  if (isAtOrBelow(newParentPath, movingPath)) {
    throw new AppError(
      'HIERARCHY_CYCLE',
      'That would move an item inside its own subtree. Pick a destination outside it.',
    );
  }
}

/**
 * The new path a descendant takes after its subtree root moves.
 *
 * `oldPath` is the descendant's current path, `oldRoot` the moving subtree's
 * current path, `newRoot` its destination path. Callers should prefer the
 * single-statement SQL form below; this exists for tests and for computing
 * change-set before/after values.
 */
export function repointPath(oldPath: string, oldRoot: string, newRoot: string): string {
  if (!isAtOrBelow(oldPath, oldRoot)) return oldPath;
  return `${newRoot}${oldPath.slice(oldRoot.length)}`;
}

/**
 * Depth of the deepest descendant after a move, used to reject a reparent that
 * would push part of the subtree past MAX_HIERARCHY_DEPTH.
 */
export function assertDepthAfterMove(
  deepestDescendantDepth: number,
  movingDepth: number,
  newParentDepth: number,
): void {
  const delta = newParentDepth + 1 - movingDepth;
  const resulting = deepestDescendantDepth + delta;
  if (resulting > MAX_HIERARCHY_DEPTH) {
    throw new AppError(
      'VALIDATION_ERROR',
      `That move would nest items ${resulting} levels deep; the limit is ${MAX_HIERARCHY_DEPTH}.`,
    );
  }
}
