import { and, eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { withWorkspace } from '@/server/db';
import { users, workspaceMembers } from '@/server/db/schema/workspaces';
import { getSessionUser } from '@/server/auth/session';
import { resolveSessionContext } from '@/server/auth/middleware';
import { ActivityPage } from '@/components/activity/ActivityPage';
import { checkDatabaseReadiness } from '@/server/db/readiness';
import { SetupHelp } from '@/components/SetupHelp';

export const dynamic = 'force-dynamic';

export default async function ActivityRoute({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Pages render in parallel with the layout, so a broken local setup would
  // surface here as a masked Server Component error before the layout's
  // SetupHelp could — every DB-touching page carries its own guard.
  const readiness = await checkDatabaseReadiness();
  if (readiness.state !== 'ready') return <SetupHelp readiness={readiness} />;
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
