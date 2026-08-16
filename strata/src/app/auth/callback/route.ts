/**
 * Exchanges the magic-link code for a session, then routes the person to
 * where they actually belong: a returning member goes straight to their
 * first workspace, a brand-new user goes to `/onboarding` to name one.
 */

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionUser } from '@/server/auth/session';
import { listWorkspacesForUser } from '@/server/services/workspaces.service';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const origin = url.origin;

  if (!code) return NextResponse.redirect(`${origin}/login`);

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => {
          for (const { name, value, options } of toSet) cookieStore.set(name, value, options);
        },
      },
    },
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
  }

  const user = await getSessionUser();
  if (!user) return NextResponse.redirect(`${origin}/login`);

  const memberships = await listWorkspacesForUser(user.id);
  const first = memberships[0];
  return NextResponse.redirect(
    first ? `${origin}/w/${first.slug}` : `${origin}/onboarding`,
  );
}
