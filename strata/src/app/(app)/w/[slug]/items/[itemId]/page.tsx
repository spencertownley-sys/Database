import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { withWorkspace } from '@/server/db';
import { items } from '@/server/db/schema/items';
import { users, workspaceMembers } from '@/server/db/schema/workspaces';
import { getSessionUser } from '@/server/auth/session';
import { resolveSessionContext } from '@/server/auth/middleware';
import { getItemTypeWithSchema } from '@/server/services/itemTypes.service';
import { ItemDetailPage } from '@/components/item-detail/ItemDetailPage';
import { checkDatabaseReadiness } from '@/server/db/readiness';
import { SetupHelp } from '@/components/SetupHelp';

export const dynamic = 'force-dynamic';

/** Deep link to one item (UI/UX §3.5) — the panel, rendered as a full page. */
export default async function ItemPage({
  params,
}: {
  params: Promise<{ slug: string; itemId: string }>;
}) {
  const { slug, itemId } = await params;

  // Pages render in parallel with the layout, so a broken local setup would
  // surface here as a masked Server Component error before the layout's
  // SetupHelp could — every DB-touching page carries its own guard.
  const readiness = await checkDatabaseReadiness();
  if (readiness.state !== 'ready') return <SetupHelp readiness={readiness} />;

  const user = await getSessionUser();
  if (!user) notFound();
  const context = await resolveSessionContext(user, slug);

  const itemTypeId = await withWorkspace(context.workspace.id, async (tx) => {
    const [row] = await tx
      .select({ itemTypeId: items.itemTypeId })
      .from(items)
      .where(and(eq(items.workspaceId, context.workspace.id), eq(items.id, itemId)))
      .limit(1);
    return row?.itemTypeId ?? null;
  });
  if (!itemTypeId) notFound();

  const [itemType, members] = await Promise.all([
    withWorkspace(context.workspace.id, (tx) =>
      getItemTypeWithSchema(tx, context.workspace.id, itemTypeId),
    ),
    withWorkspace(context.workspace.id, (tx) =>
      tx
        .select({ id: users.id, name: users.name, email: users.email })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(
          and(
            eq(workspaceMembers.workspaceId, context.workspace.id),
            eq(workspaceMembers.status, 'active'),
          ),
        ),
    ),
  ]);

  return (
    <ItemDetailPage
      workspaceId={context.workspace.id}
      itemId={itemId}
      fields={itemType.fields}
      fieldGroups={itemType.fieldGroups}
      members={members}
    />
  );
}
