import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { withWorkspace } from '@/server/db';
import { users, workspaceMembers } from '@/server/db/schema/workspaces';
import { getSessionUser } from '@/server/auth/session';
import { resolveSessionContext } from '@/server/auth/middleware';
import { getItemTypeWithSchema } from '@/server/services/itemTypes.service';
import { editableFieldKeysFor } from '@/server/services/permissions.service';
import { GridWorkspace } from '@/components/grid/GridWorkspace';
import { AppError } from '@/server/lib/errors';

export const dynamic = 'force-dynamic';

export default async function ItemTypeGridPage({
  params,
}: {
  params: Promise<{ slug: string; typeId: string }>;
}) {
  const { slug, typeId } = await params;

  const user = await getSessionUser();
  if (!user) notFound();

  const context = await resolveSessionContext(user, slug);

  let itemType;
  try {
    itemType = await withWorkspace(context.workspace.id, (tx) =>
      getItemTypeWithSchema(tx, context.workspace.id, typeId),
    );
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }

  // Members are loaded once here rather than per cell: a `user` editor opening
  // on 300 rows would otherwise issue 300 identical requests.
  const members = await withWorkspace(context.workspace.id, (tx) =>
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
  );

  return (
    <GridWorkspace
      workspaceSlug={slug}
      workspaceId={context.workspace.id}
      itemType={itemType}
      members={members}
      editableFieldKeys={editableFieldKeysFor(context.actor, [])}
    />
  );
}
