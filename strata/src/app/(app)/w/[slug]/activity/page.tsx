import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { withWorkspace } from '@/server/db';
import { users, workspaceMembers } from '@/server/db/schema/workspaces';
import { getSessionUser } from '@/server/auth/session';
import { resolveSessionContext } from '@/server/auth/middleware';
import { ActivityPage } from '@/components/activity/ActivityPage';

export const dynamic = 'force-dynamic';

export default async function ActivityRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) notFound();
  const context = await resolveSessionContext(user, slug);

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

  return <ActivityPage workspaceId={context.workspace.id} members={members} />;
}
