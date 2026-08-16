import { notFound } from 'next/navigation';
import { getSessionUser } from '@/server/auth/session';
import { resolveSessionContext } from '@/server/auth/middleware';
import { TreeManager } from '@/components/trees/TreeManager';
import { checkDatabaseReadiness } from '@/server/db/readiness';
import { SetupHelp } from '@/components/SetupHelp';

export const dynamic = 'force-dynamic';

/** Category tree manager (UI/UX §3.7) — organize, then see what's inside. */
export default async function TreesPage({
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

  return <TreeManager workspaceId={context.workspace.id} workspaceSlug={slug} />;
}
