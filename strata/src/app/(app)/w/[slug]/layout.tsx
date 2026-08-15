import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listItemTypes } from '@/server/services/itemTypes.service';
import { withWorkspace } from '@/server/db';
import { getSessionUser } from '@/server/auth/session';
import { resolveSessionContext } from '@/server/auth/middleware';
import { Providers } from '@/app/providers';
import { NotificationBell } from '@/components/notifications/NotificationBell';
import { AppError } from '@/server/lib/errors';
import { checkDatabaseReadiness } from '@/server/db/readiness';
import { SetupHelp } from '@/components/SetupHelp';

export const dynamic = 'force-dynamic';

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Diagnosed before anything else touches the database. A connection failure
  // inside a Server Component reaches the browser as an unlabelled
  // AggregateError, which tells the person setting this up nothing at all.
  const readiness = await checkDatabaseReadiness();
  if (readiness.state !== 'ready') return <SetupHelp readiness={readiness} />;

  const user = await getSessionUser();

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 px-6">
        <h1 className="text-lg font-semibold">Sign in to continue</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">
          No session was found. In local development without Supabase configured, set{' '}
          <code className="rounded bg-[var(--color-muted)] px-1">STRATA_DEV_USER</code> to a seeded
          address such as <code className="rounded bg-[var(--color-muted)] px-1">alice@northwind.test</code>.
        </p>
      </main>
    );
  }

  let context;
  try {
    context = await resolveSessionContext(user, slug);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) notFound();
    throw error;
  }

  const itemTypes = await withWorkspace(context.workspace.id, (tx) =>
    listItemTypes(tx, context.workspace.id),
  );

  return (
    <Providers>
      <div className="flex h-screen flex-col">
        <header className="flex h-11 shrink-0 items-center gap-3 border-b bg-[var(--color-surface)] px-3">
          <span className="text-sm font-semibold">{context.workspace.name}</span>
          <span className="rounded bg-[var(--color-muted)] px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-[var(--color-ink-muted)]">
            {context.actor.role}
          </span>
          <span className="ml-auto text-xs text-[var(--color-ink-subtle)]">{user.email}</span>
          <NotificationBell workspaceId={context.workspace.id} workspaceSlug={slug} />
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="w-56 shrink-0 overflow-y-auto border-r bg-[var(--color-surface)] p-2">
            <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-subtle)]">
              Organize
            </p>
            <ul className="mb-2 space-y-0.5">
              <li>
                <Link
                  href={`/w/${slug}/trees`}
                  className="flex items-center rounded px-2 py-1.5 text-sm hover:bg-[var(--color-muted)]"
                >
                  Category trees
                </Link>
              </li>
              <li>
                <Link
                  href={`/w/${slug}/import`}
                  className="flex items-center rounded px-2 py-1.5 text-sm hover:bg-[var(--color-muted)]"
                >
                  Import
                </Link>
              </li>
              <li>
                <Link
                  href={`/w/${slug}/activity`}
                  className="flex items-center rounded px-2 py-1.5 text-sm hover:bg-[var(--color-muted)]"
                >
                  Activity
                </Link>
              </li>
            </ul>
            <p className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--color-ink-subtle)]">
              Item types
            </p>
            <ul className="space-y-0.5">
              {itemTypes.map((type) => (
                <li key={type.id}>
                  <Link
                    href={`/w/${slug}/types/${type.id}`}
                    className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-[var(--color-muted)]"
                  >
                    <span className="truncate">{type.pluralLabel ?? type.label}</span>
                    <span className="tabular shrink-0 text-xs text-[var(--color-ink-subtle)]">
                      {type.itemCount}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <main className="min-w-0 flex-1">{children}</main>
        </div>
      </div>
    </Providers>
  );
}
