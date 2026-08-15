'use client';

/** The 500 boundary. Nothing here may read the error message into the DOM —
 * a raw server error can leak schema or tenant details. The digest is the
 * safe handle support can look up. */

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 px-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-subtle)]">
        Something broke
      </p>
      <h1 className="text-lg font-semibold">That wasn’t supposed to happen</h1>
      <p className="text-sm text-[var(--color-ink-muted)]">
        Your data is safe — every write happens in a transaction, so a crash never leaves things
        half-saved. Try again; if it keeps happening, send support this reference:
      </p>
      {error.digest && (
        <code className="w-fit rounded bg-[var(--color-muted)] px-2 py-1 text-xs">{error.digest}</code>
      )}
      <button
        type="button"
        className="w-fit rounded bg-[var(--color-primary)] px-3 py-1.5 text-sm text-white"
        onClick={reset}
      >
        Try again
      </button>
    </main>
  );
}
