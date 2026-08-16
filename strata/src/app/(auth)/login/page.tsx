'use client';

/**
 * The one real entry point — magic link, not a password. No password means
 * no password-reset flow to build, no credential to leak, and "sign up" and
 * "sign in" are the same action: the first magic link click creates the
 * Supabase Auth user, `getSessionUser()` upserts a local `users` row on
 * first sight, and the callback route sends a brand-new user to
 * `/onboarding` instead of a workspace that doesn't exist yet.
 */

import { useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';

const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('sending');
    setError(null);
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL as string,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      );
      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
      });
      if (authError) throw authError;
      setStatus('sent');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : 'That link could not be sent.');
    }
  };

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-widest text-[var(--color-ink-subtle)]">
          Strata
        </p>
        <h1 className="mt-1 text-xl font-semibold">Sign in</h1>
      </div>

      {!SUPABASE_CONFIGURED ? (
        <p className="rounded border border-[var(--color-warning)] bg-[var(--color-warning-soft)] px-3 py-2 text-sm">
          Supabase isn&apos;t configured on this deployment yet — set{' '}
          <code className="rounded bg-[var(--color-muted)] px-1">NEXT_PUBLIC_SUPABASE_URL</code>{' '}
          and{' '}
          <code className="rounded bg-[var(--color-muted)] px-1">
            NEXT_PUBLIC_SUPABASE_ANON_KEY
          </code>{' '}
          before anyone can sign in. In local development, use{' '}
          <code className="rounded bg-[var(--color-muted)] px-1">STRATA_DEV_USER</code> instead.
        </p>
      ) : status === 'sent' ? (
        <p className="rounded border bg-[var(--color-muted)] px-3 py-2 text-sm">
          Check <span className="font-medium">{email}</span> for a sign-in link. It works whether
          this is your first visit or your hundredth.
        </p>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={sendLink}>
          <label className="text-sm">
            <span className="mb-1 block text-[var(--color-ink-muted)]">Email</span>
            <input
              type="email"
              required
              autoFocus
              className="w-full rounded-[var(--radius-md)] border px-3 py-2 text-sm outline-none focus:border-[var(--color-accent)]"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-[var(--color-danger)]">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={status === 'sending'}
            className="rounded-[var(--radius-md)] bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
          >
            {status === 'sending' ? 'Sending…' : 'Send sign-in link'}
          </button>
        </form>
      )}
    </main>
  );
}
