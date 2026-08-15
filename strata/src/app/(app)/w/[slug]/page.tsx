import { redirect } from 'next/navigation';
import { withWorkspace } from '@/server/db';
import { getSessionUser } from '@/server/auth/session';
import { resolveSessionContext } from '@/server/auth/middleware';
import { listItemTypes } from '@/server/services/itemTypes.service';

export const dynamic = 'force-dynamic';

/** Workspace home: straight into the first Item Type's grid. */
export default async function WorkspaceHome({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) {
    return (
      <p className="p-10 text-sm text-[var(--color-ink-muted)]">Sign in to open this workspace.</p>
    );
  }

  const context = await resolveSessionContext(user, slug);
  const itemTypes = await withWorkspace(context.workspace.id, (tx) =>
    listItemTypes(tx, context.workspace.id),
  );

  const first = itemTypes[0];
  if (first) redirect(`/w/${slug}/types/${first.id}`);

  return (
    <div className="mx-auto max-w-md p-10 text-center">
      <p className="text-sm font-medium">This workspace has no item types yet.</p>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        An Item Type is a reusable shape for a kind of work — its fields, and how they nest. Start
        from a preset and rename what does not fit.
      </p>
    </div>
  );
}
