import { asWorkspace, ownerClient, closeTestDb } from '~/tests/integration/helpers/db';
import { searchProvider } from '@/server/search/PostgresSearchProvider';
import { fields as fieldsTable } from '@/server/db/schema/itemTypes';
import { eq } from 'drizzle-orm';

const ws = 'a4e8a9e2-4ccc-473e-aec1-0fec551d97bb';
const fields = await asWorkspace(ws, (tx) => tx.select().from(fieldsTable).where(eq(fieldsTable.workspaceId, ws)));
const [type] = await ownerClient<Array<{id: string}>>`select id from item_types where workspace_id = ${ws}`;
try {
  const page = await asWorkspace(ws, (tx) =>
    searchProvider.search(tx, ws, fields, {
      itemTypeId: type!.id,
      filter: {
        op: 'and',
        children: [
          { field: 'f1', operator: 'in', value: ['opt_a', 'opt_b'] },
          { field: 'f5', operator: 'on_or_after', value: '2026-02-01' },
          { field: 'f7', operator: 'is_true' },
        ],
      } as never,
      limit: 10,
    }),
  );
  console.log('OK rows:', page.items.length);
} catch (e) {
  console.log('ERROR:', (e as Error).message);
  console.log((e as { cause?: Error }).cause?.message ?? '');
}
await closeTestDb();
