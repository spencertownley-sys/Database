/**
 * Supabase SSR session refresh — the standard `@supabase/ssr` Next.js
 * middleware pattern. `getSessionUser()` reads the auth cookie on every
 * request but never refreshes it; without this, a token nearing expiry would
 * make server components see a stale session and log people out mid-visit.
 * A no-op (never throws, never redirects) when Supabase isn't configured, so
 * local dev with `STRATA_DEV_USER` is unaffected.
 */

import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
      },
    },
  });

  // Re-validates against Supabase and refreshes the cookie if needed —
  // reading the cookie alone (like `getSession()`) would trust whatever is
  // there without checking it is still valid.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    /*
     * Every request except static assets and Next internals — the session
     * cookie needs to stay fresh for pages and API routes alike.
     */
    '/((?!_next/static|_next/image|favicon.ico|icon.svg).*)',
  ],
};
