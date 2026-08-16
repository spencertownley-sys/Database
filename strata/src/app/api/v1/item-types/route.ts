import { asc, and, isNull, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { withWorkspace } from '@/server/db';
import { fieldGroups, fields as fieldsTable } from '@/server/db/schema/itemTypes';
import { handle, parseBody, parseQuery } from '@/server/lib/route';
import { collection } from '@/lib/wire';
import {
  createItemType,
  createItemTypeFromPreset,
  listItemTypes,
} from '@/server/services/itemTypes.service';
import { assertCan } from '@/server/services/permissions.service';
import { createItemTypeSchema } from '@/server/validation/schemas';

export const dynamic = 'force-dynamic';

const listQuerySchema = z.object({
  /** Comma-separated: `fields`, `field_groups` (§3). */
  expand: z.string().max(200).optional(),
  includeArchived: z
    .enum(['true', 'false', '1', '0'])
    .transform((v) => v === 'true' || v === '1')
    .optional(),
});

/** `GET /item-types` — §1.2 collection envelope, schema expanded on request. */
export async function GET(request: Request): Promise<Response> {
  return handle(request, async ({ context }) => {
    assertCan(context.actor, 'item_type.read', { kind: 'item_type' });
    const query = parseQuery(request, listQuerySchema);
    const expand = new Set(
      (query.expand ?? '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean),
    );

    return withWorkspace(context.workspace.id, async (tx) => {
      const types = await listItemTypes(tx, context.workspace.id);
      if (types.length === 0) {
        return collection([], { cursor: null, hasMore: false, total: 0 });
      }

      const typeIds = types.map((t) => t.id);
      const wantFields = expand.has('fields');
      const wantGroups = expand.has('fieldGroups') || expand.has('field_groups');

      const [allFields, allGroups] = await Promise.all([
        wantFields
          ? tx
              .select()
              .from(fieldsTable)
              .where(and(inArray(fieldsTable.itemTypeId, typeIds), isNull(fieldsTable.deletedAt)))
              .orderBy(asc(fieldsTable.position))
          : Promise.resolve([]),
        wantGroups
          ? tx
              .select()
              .from(fieldGroups)
              .where(inArray(fieldGroups.itemTypeId, typeIds))
              .orderBy(asc(fieldGroups.position))
          : Promise.resolve([]),
      ]);

      const data = types.map((type) => ({
        ...type,
        ...(wantFields ? { fields: allFields.filter((f) => f.itemTypeId === type.id) } : {}),
        ...(wantGroups ? { fieldGroups: allGroups.filter((g) => g.itemTypeId === type.id) } : {}),
      }));

      return collection(data, { cursor: null, hasMore: false, total: types.length });
    });
  });
}

/** `POST /item-types` — returns the created type at the top level (§1.2). */
export async function POST(request: Request): Promise<Response> {
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'item_type.create', { kind: 'item_type' });
      const input = await parseBody(request, createItemTypeSchema);

      return withWorkspace(context.workspace.id, async (tx) => {
        // A preset arrives populated; a bare type does not. The two-minute
        // path always goes through a preset, so this is the common branch.
        if (input.preset) {
          return createItemTypeFromPreset(
            tx,
            context.workspace.id,
            input.preset,
            context.actor.userId,
            { name: input.label, key: input.key },
          );
        }

        const created = await createItemType(tx, context.workspace.id, input, context.actor.userId);
        return { ...created, fields: [], fieldGroups: [] };
      });
    },
    { limit: 'write', status: 201 },
  );
}
