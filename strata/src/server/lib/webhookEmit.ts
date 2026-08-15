/**
 * Post-commit webhook emission. Call these AFTER the transaction that
 * committed the change set has closed — delivery opens its own transactions
 * and makes outbound HTTP, neither of which belongs inside a commit.
 *
 * A bulk change set emits exactly one `change_set.committed`; a single-item
 * set additionally emits the specific `item.*` event (§12: 10,000-item bulk
 * edits must not become 10,000 webhooks). Payloads carry ids and counts, not
 * field values — consumers fetch the item through the API they already hold.
 */

import type { ChangeSet } from '@/server/db/schema/changeSets';
import {
  emitWebhookEvents,
  type WebhookEventInput,
} from '@/server/services/webhooks.service';

const ITEM_EVENT_BY_OPERATION: Record<string, WebhookEventInput['event']> = {
  create: 'item.created',
  delete: 'item.deleted',
  assign_user: 'item.assigned',
  change_type: 'item.type_changed',
};

export function eventsForCommit(
  changeSet: ChangeSet,
  extras: { appliedCount?: number; itemId?: string | null } = {},
): WebhookEventInput[] {
  const data: Record<string, unknown> = {
    change_set_id: changeSet.id,
    operation: changeSet.operation,
    item_count: changeSet.itemCount,
    applied_count: extras.appliedCount ?? changeSet.itemCount,
    actor_id: changeSet.actorId,
    source: changeSet.source,
  };

  const events: WebhookEventInput[] = [{ event: 'change_set.committed', data }];
  if (changeSet.itemCount === 1) {
    events.push({
      event: ITEM_EVENT_BY_OPERATION[changeSet.operation] ?? 'item.updated',
      data: { ...data, item_id: extras.itemId ?? null },
    });
  }
  return events;
}

/** Fire-and-forget: a slow or dead endpoint must not slow the user's write. */
export function emitCommitted(
  workspaceId: string,
  changeSet: ChangeSet,
  extras: { appliedCount?: number; itemId?: string | null } = {},
): void {
  void emitWebhookEvents(workspaceId, eventsForCommit(changeSet, extras)).catch(() => {});
}

export function emitUndone(workspaceId: string, originalChangeSetId: string, undoChangeSetId: string): void {
  void emitWebhookEvents(workspaceId, [
    {
      event: 'change_set.undone',
      data: { change_set_id: originalChangeSetId, undo_change_set_id: undoChangeSetId },
    },
  ]).catch(() => {});
}

export function emitImportCompleted(
  workspaceId: string,
  data: { importId: string; changeSetId: string; rowCount: number },
): void {
  void emitWebhookEvents(workspaceId, [
    {
      event: 'import.completed',
      data: {
        import_id: data.importId,
        change_set_id: data.changeSetId,
        row_count: data.rowCount,
      },
    },
  ]).catch(() => {});
}
