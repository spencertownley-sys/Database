import { asc, and, isNull, inArray } from 'drizzle-orm';
import { withWorkspace } from '@/server/db';
import { fieldGroups, fields as fieldsTable } from '@/server/db/schema/itemTypes';
import { handle, parseBody } from '@/server/lib/route';
import {
  createItemType,
  createItemTypeFromPreset,
  listItemTypes,
} from '@/server/services/itemTypes.service';
import { assertCan } from '@/server/services/permissions.service';
import { createItemTypeSchema } from '@/server/validation/schemas';

export const dynamic = 'force-dynamic';

/** Types with their full schema — the grid needs columns before it needs rows. */
export async function GET(request: Request): Promise<Response> {
  return handle(request, async ({ context }) => {
    assertCan(context.actor, 'item_type.read', { kind: 'item_type' });

    return withWorkspace(context.workspace.id, async (tx) => {
      const types = await listItemTypes(tx, context.workspace.id);
      if (types.length === 0) return { itemTypes: [] };

      const typeIds = types.map((t) => t.id);
      const [allFields, allGroups] = await Promise.all([
        tx
          .select()
          .from(fieldsTable)
          .where(
            and(inArray(fieldsTable.itemTypeId, typeIds), isNull(fieldsTable.deletedAt)),
          )
          .orderBy(asc(fieldsTable.orderKey)),
        tx
          .select()
          .from(fieldGroups)
          .where(inArray(fieldGroups.itemTypeId, typeIds))
          .orderBy(asc(fieldGroups.orderKey)),
      ]);

      return {
        itemTypes: types.map((type) => ({
          ...type,
          fields: allFields.filter((f) => f.itemTypeId === type.id),
          groups: allGroups.filter((g) => g.itemTypeId === type.id),
        })),
      };
    });
  });
}

export async function POST(request: Request): Promise<Response> {
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'item_type.create', { kind: 'item_type' });
      const input = await parseBody(request, createItemTypeSchema);

      return withWorkspace(context.workspace.id, async (tx) => {
        // A preset arrives populated; a bare type does not. The two-minute
        // path always goes through a preset, so this is the common branch.
        if (input.presetKey) {
          const created = await createItemTypeFromPreset(
            tx,
            context.workspace.id,
            input.presetKey,
            context.actor.userId,
            { name: input.name, key: input.key },
          );
          return { itemType: created };
        }

        const created = await createItemType(
          tx,
          context.workspace.id,
          input,
          context.actor.userId,
        );
        return { itemType: { ...created, fields: [], groups: [] } };
      });
    },
    { limit: 'write' },
  );
}

