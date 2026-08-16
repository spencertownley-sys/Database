import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-ink-subtle)]">
          Strata
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          Structured work management for teams that outgrew a task list.
        </h1>
        <p className="text-[var(--color-ink-muted)] text-pretty">
          Define your own item types, nest work in a hierarchy, classify it in category trees, and
          edit hundreds of rows at a time in a grid that behaves like a spreadsheet — with a preview
          before every bulk change and an undo after it.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/login"
          className="rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)]"
        >
          Sign in or create a workspace
        </Link>
      </div>
    </main>
  );
}
