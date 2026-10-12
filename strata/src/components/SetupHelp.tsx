import type { Readiness } from '@/server/db/readiness';

/**
 * Rendered instead of a crash when the database is not usable.
 *
 * The raw driver message is shown only outside production: locally it is the
 * fastest route to the cause, and in production it would disclose host names
 * and connection topology to anyone who can reach a 500.
 */
export function SetupHelp({ readiness }: { readiness: Readiness }) {
  const showRaw = process.env.NODE_ENV !== 'production' && readiness.raw;

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center gap-5 px-6 py-16">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-ink-subtle)]">
          Setup
        </p>
        <h1 className="text-xl font-semibold tracking-tight">{readiness.title}</h1>
        <p className="text-sm text-[var(--color-ink-muted)]">{readiness.detail}</p>
      </div>

      {readiness.fix.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Run these, in order:</p>
          <pre className="overflow-x-auto rounded-[var(--radius-md)] bg-[var(--color-ink)] px-3 py-2 text-xs leading-6 text-white">
            <code>{readiness.fix.join('\n')}</code>
          </pre>
        </div>
      )}

      {showRaw && (
        <details className="rounded-[var(--radius-md)] border px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-[var(--color-ink-muted)]">
            Driver error
          </summary>
          <p className="mt-2 font-mono text-xs break-all text-[var(--color-ink-muted)]">
            {readiness.raw}
          </p>
        </details>
      )}

      <p className="text-xs text-[var(--color-ink-subtle)]">
        Next.js hides Server Component error messages in the browser, so the terminal running{' '}
        <code className="rounded bg-[var(--color-muted)] px-1">npm run dev</code> always has more
        detail than the page does.
      </p>
    </main>
  );
}
