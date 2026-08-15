import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 px-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-subtle)]">
        404
      </p>
      <h1 className="text-lg font-semibold">This page doesn’t exist</h1>
      <p className="text-sm text-[var(--color-ink-muted)]">
        The link may be stale, the item may have been deleted, or it may live in a workspace you’re
        not signed into. Nothing here tells you which — that’s deliberate.
      </p>
      <p className="text-sm">
        <Link className="underline underline-offset-2" href="/">
          Back to your workspace
        </Link>
      </p>
    </main>
  );
}
