/**
 * Session resolution.
 *
 * Supabase Auth issues the JWT; `@supabase/ssr` keeps it in an httpOnly
 * cookie. This module turns that into a `users` row, creating one on first
 * sight so the rest of the codebase can reference a local user id without
 * reaching across to `auth.users` on every join.
 */

import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { eq, sql } from 'drizzle-orm';
import { withoutWorkspace } from '@/server/db';
import { users, type User } from '@/server/db/schema/workspaces';
import { AppError } from '@/server/lib/errors';

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export const isSupabaseConfigured =
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

/**
 * Local development without a Supabase project.
 *
 * Deliberately narrow: it requires `STRATA_DEV_USER` to be set *and*
 * `NODE_ENV !== 'production'` *and* Supabase to be unconfigured. It throws
 * rather than degrades if it is ever reached in a production build — a dev
 * auth bypass that survives to production is the single worst thing this file
 * could ship.
 */
function devUserEmail(): string | null {
  if (process.env.NODE_ENV === 'production') return null;
  if (isSupabaseConfigured) return null;
  return process.env.STRATA_DEV_USER ?? null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const devEmail = devUserEmail();
  if (devEmail) {
    const row = await findUserByEmail(devEmail);
    if (!row) return null;
    return { id: row.id, email: row.email, name: row.name, avatarUrl: row.avatarUrl };
  }

  if (!isSupabaseConfigured) return null;

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          try {
            for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
          } catch {
            // Called from a Server Component, where cookies are read-only.
            // The middleware refreshes the session, so this is safe to ignore.
          }
        },
      },
    },
  );

  // `getUser()` re-validates against Supabase; `getSession()` trusts whatever
  // is in the cookie, which is forgeable by anyone who can write cookies.
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user?.email) return null;

  const local = await upsertLocalUser({
    authUserId: data.user.id,
    email: data.user.email,
    name:
      (data.user.user_metadata?.full_name as string | undefined) ??
      (data.user.user_metadata?.name as string | undefined) ??
      null,
    avatarUrl: (data.user.user_metadata?.avatar_url as string | undefined) ?? null,
  });

  return { id: local.id, email: local.email, name: local.name, avatarUrl: local.avatarUrl };
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AppError('UNAUTHORIZED', 'Sign in to continue.');
  return user;
}

async function findUserByEmail(email: string): Promise<User | null> {
  return withoutWorkspace(async (tx) => {
    const rows = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${email})`)
      .limit(1);
    return rows[0] ?? null;
  });
}

async function upsertLocalUser(input: {
  authUserId: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}): Promise<User> {
  return withoutWorkspace(async (tx) => {
    const existingByAuth = await tx
      .select()
      .from(users)
      .where(eq(users.authUserId, input.authUserId))
      .limit(1);

    if (existingByAuth[0]) return existingByAuth[0];

    // An invited teammate already has a `users` row created by the invite
    // flow, keyed by email with no auth id. Claim it rather than creating a
    // duplicate, or their pending memberships would point at the wrong row.
    const existingByEmail = await tx
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = lower(${input.email})`)
      .limit(1);

    if (existingByEmail[0]) {
      const [updated] = await tx
        .update(users)
        .set({
          authUserId: input.authUserId,
          name: existingByEmail[0].name ?? input.name,
          avatarUrl: input.avatarUrl ?? existingByEmail[0].avatarUrl,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingByEmail[0].id))
        .returning();
      if (updated) return updated;
    }

    const [created] = await tx
      .insert(users)
      .values({
        authUserId: input.authUserId,
        email: input.email.toLowerCase(),
        name: input.name,
        avatarUrl: input.avatarUrl,
      })
      .returning();

    if (!created) throw new AppError('INTERNAL_ERROR', 'Could not create the user record.');
    return created;
  });
}
