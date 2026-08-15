import { and, eq, gt } from 'drizzle-orm';
import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { changeEntries } from '@/server/db/schema/changeSets';
import { handle, parseQuery } from '@/server/lib/route';
import { collection } from '@/lib/wire';
import { getChangeSet } from '@/server/services/changeSets.service';
import type { ItemSnapshot } from '@/server/services/items.service';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/**
 * `GET /change-sets/:id/entries` — API Design §5: one row per item per field,
 * `{ item_id, field_key, before, after }`, paginated.
 *
 * Internally an entry stores a complete before/after snapshot per item (see
 * `changeSets.service.ts` — snapshots are what make undo a swap rather than
 * nine inverse implementations). The per-field rows the contract publishes are
 * **derived here at read time**, so the storage decision stays private and the
 * published shape stays §5. This is the deliberate resolution of
 * docs/SPEC_RECONCILIATION.md §3.1.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  return handle(request, async ({ context }) =>
    withWorkspace(context.workspace.id, async (tx) => {
      await getChangeSet(tx, context.workspace.id, id); // 404s cross-tenant

      const query = parseQuery(request, querySchema);
      const rows = await tx
        .select()
        .from(changeEntries)
        .where(
          and(
            eq(changeEntries.workspaceId, context.workspace.id),
            eq(changeEntries.changeSetId, id),
            query.cursor !== undefined ? gt(changeEntries.seq, query.cursor) : undefined,
          ),
        )
        .orderBy(changeEntries.seq)
        .limit(query.limit + 1);

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;

      const data = page.flatMap((entry) =>
        deriveFieldEntries(
          entry.itemId,
          entry.before as ItemSnapshot | null,
          entry.after as ItemSnapshot | null,
          entry.skipped,
          entry.skipReason,
        ),
      );

      const last = page[page.length - 1];
      return collection(data, {
        cursor: hasMore && last ? String(last.seq) : null,
        hasMore,
        total: null,
      });
    }),
  );
}

interface WireEntry {
  itemId: string | null;
  /** Null for whole-item facts: create, delete, reparent, tree membership. */
  fieldKey: string | null;
  before: unknown;
  after: unknown;
  skipped?: boolean;
  skipReason?: string | null;
}

/** Per-item snapshot pair → the §5 per-field rows. */
function deriveFieldEntries(
  itemId: string | null,
  before: ItemSnapshot | null,
  after: ItemSnapshot | null,
  skipped: boolean,
  skipReason: string | null,
): WireEntry[] {
  if (skipped) {
    return [{ itemId, fieldKey: null, before: null, after: null, skipped, skipReason }];
  }

  const out: WireEntry[] = [];

  // Whole-item transitions: create and delete are one row with field_key null.
  if (before === null || after === null || before.deleted !== after.deleted) {
    out.push({
      itemId,
      fieldKey: null,
      before: before === null || before.deleted ? null : { title: before.title },
      after: after === null || after.deleted ? null : { title: after.title },
    });
  }

  const beforeValues = before?.values ?? {};
  const afterValues = after?.values ?? {};
  const keys = new Set([...Object.keys(beforeValues), ...Object.keys(afterValues)]);
  for (const key of keys) {
    const b = beforeValues[key] ?? null;
    const a = afterValues[key] ?? null;
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      out.push({ itemId, fieldKey: key, before: b, after: a });
    }
  }

  if (before && after) {
    if (before.title !== after.title) {
      out.push({ itemId, fieldKey: '$title', before: before.title, after: after.title });
    }
    if (before.parentId !== after.parentId) {
      out.push({ itemId, fieldKey: '$parent_id', before: before.parentId, after: after.parentId });
    }
    if (before.assigneeId !== after.assigneeId) {
      out.push({
        itemId,
        fieldKey: '$assignee_id',
        before: before.assigneeId,
        after: after.assigneeId,
      });
    }
    const beforeNodes = (before.treeNodeIds ?? []).join(',');
    const afterNodes = (after.treeNodeIds ?? []).join(',');
    if (beforeNodes !== afterNodes) {
      out.push({
        itemId,
        fieldKey: '$tree_node_id',
        before: before.treeNodeIds,
        after: after.treeNodeIds,
      });
    }
  }

  return out;
}
