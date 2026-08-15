import { notFound } from 'next/navigation';
import { getSessionUser } from '@/server/auth/session';
import { resolveSessionContext } from '@/server/auth/middleware';
import { TreeManager } from '@/components/trees/TreeManager';

export const dynamic = 'force-dynamic';

/** Category tree manager (UI/UX §3.7) — organize, then see what's inside. */
export default async function TreesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const user = await getSessionUser();
  if (!user) notFound();
  const context = await resolveSessionContext(user, slug);

  return <TreeManager workspaceId={context.workspace.id} workspaceSlug={slug} />;
}
