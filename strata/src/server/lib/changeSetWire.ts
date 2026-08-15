/**
 * Change-set wire shapes — API Design §5.
 *
 * The stored row carries more than the contract documents (`target`, `patch`,
 * plumbing columns); the wire shape picks exactly what §5 publishes plus a few
 * additive counts. Shaping happens here rather than per-route so the preview,
 * commit, and undo responses cannot drift apart.
 */

import type { ChangeSet } from '@/server/db/schema/changeSets';
import { UNDO_WINDOW_HOURS } from '@/server/services/changeSets.service';

export function undoAvailableUntil(changeSet: ChangeSet): Date | null {
  if (!changeSet.committedAt) return null;
  return new Date(changeSet.committedAt.getTime() + UNDO_WINDOW_HOURS * 3_600_000);
}

/** The §5 preview/read shape. `toWire` snake_cases it at the boundary. */
export function shapeChangeSet(changeSet: ChangeSet): Record<string, unknown> {
  const skipped = (changeSet.sampleEntries ?? [])
    .filter((entry) => entry.skipped)
    .map((entry) => ({ itemId: entry.itemId, reason: entry.skipReason ?? 'skipped' }));

  return {
    id: changeSet.id,
    status: changeSet.status,
    operation: changeSet.operation,
    source: changeSet.source,
    itemTypeId: changeSet.itemTypeId,
    actorId: changeSet.actorId,
    itemCount: changeSet.itemCount,
    skippedCount: changeSet.skippedCount,
    /** Sample of skipped items with reasons; `skipped_count` is the true total. */
    skipped,
    summary: changeSet.summary,
    samples: changeSet.sampleEntries,
    parentChangeSetId: changeSet.parentChangeSetId,
    undoneByChangeSetId: changeSet.undoneByChangeSetId,
    expiresAt: changeSet.expiresAt,
    committedAt: changeSet.committedAt,
    undoAvailableUntil: undoAvailableUntil(changeSet),
    createdAt: changeSet.createdAt,
  };
}
