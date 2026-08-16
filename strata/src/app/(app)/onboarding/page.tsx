import { redirect } from 'next/navigation';
import { getSessionUser } from '@/server/auth/session';
import { listWorkspacesForUser } from '@/server/services/workspaces.service';
import { checkDatabaseReadiness } from '@/server/db/readiness';
import { SetupHelp } from '@/components/SetupHelp';
import { OnboardingForm } from './OnboardingForm';

export const dynamic = 'force-dynamic';

/** First-login landing: name a workspace, or bounce straight to one you already have. */
export default async function OnboardingPage() {
  const readiness = await checkDatabaseReadiness();
  if (readiness.state !== 'ready') return <SetupHelp readiness={readiness} />;

  const user = await getSessionUser();
  if (!user) redirect('/login');

  const memberships = await listWorkspacesForUser(user.id);
  const first = memberships[0];
  if (first) redirect(`/w/${first.slug}`);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-ink-subtle)]">
          Welcome, {user.name ?? user.email}
        </p>
        <h1 className="mt-1 text-xl font-semibold">Name your workspace</h1>
        <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
          You&apos;ll get a Tasks item type and a category tree to start — everything else builds
          on those.
        </p>
      </div>
      <OnboardingForm />
    </main>
  );
}
