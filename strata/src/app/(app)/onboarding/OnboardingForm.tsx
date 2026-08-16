'use client';

import { useActionState } from 'react';
import { createWorkspaceAction } from './actions';

export function OnboardingForm() {
  const [state, formAction, pending] = useActionState(createWorkspaceAction, { error: null });

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="text-sm">
        <span className="mb-1 block text-[var(--color-ink-muted)]">Workspace name</span>
        <input
          name="name"
          required
          autoFocus
          className="w-full rounded-[var(--radius-md)] border px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
          placeholder="Acme Agency"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-[var(--color-danger)]">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
      >
        {pending ? 'Creating…' : 'Create workspace'}
      </button>
    </form>
  );
}
