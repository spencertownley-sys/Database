# Downbeat

The easiest way for a band to find time to rehearse. One person creates a
band and gets a shareable link — everyone else just taps their availability,
no account, no login, no app to download.

Built with **Next.js 14 (App Router) · Drizzle ORM · PostgreSQL/Supabase ·
Tailwind CSS + shadcn/ui**.

## How it works

- **Band leaders** sign up for an account, create a band, and get a link
  like `/join/downbeat-crew-4k2p` to send to their bandmates.
- **Band members** never sign up. They open the link, type their name once,
  and land on a personal availability page at `/a/[slug]/[memberToken]` —
  that link *is* their credential, so bookmarking or re-visiting it lets
  them come back and edit anytime.
- Members mark a **recurring weekly grid** (Sunday–Saturday ×
  morning/afternoon/evening/night, cycling through Available → Maybe → Not
  available) plus any **specific-date exceptions** ("busy Dec 25" even
  though they're normally free Wednesdays).
- The leader's dashboard shows an **aggregate heatmap** of the whole band's
  overlap, the member roster, and everyone's upcoming one-off exceptions.

## Getting started

### 1. Install

```bash
npm install
cp .env.example .env.local
```

### 2. Configure the database

**Option A — Supabase (full auth):** create a project at supabase.com, then in
`.env.local` set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, and `DATABASE_URL` (the *direct* Postgres
connection string from Project Settings → Database).

**Option B — plain local Postgres (no auth, dev only):** set only

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/downbeat
```

Without Supabase configured, the middleware skips login and dev mode falls
back to the first seeded profile, so you can explore the dashboard
immediately.

### 3. Migrate

```bash
npm run db:migrate
# or apply the SQL directly:
#   psql "$DATABASE_URL" -f src/db/migrations/0000_init.sql
```

On Supabase, additionally run `supabase/migrations/20260101000000_rls_policies.sql`
(SQL editor or `supabase db push`) to enable RLS, the signup-profile trigger,
and the `auth.users` foreign key.

### 4. Seed (optional)

```bash
npm run db:seed
```

Creates a demo leader, one band ("The Basement Tapes") with four members and
some sample availability, and prints the demo join link.

### 5. Run

```bash
npm run dev      # http://localhost:3000
npm run build && npm start   # production
```

## Project layout

```
src/
├── app/
│   ├── page.tsx              # marketing landing page (public)
│   ├── (auth)/                # login / signup — band leaders only
│   ├── join/[slug]/           # public: a member enters their name
│   ├── a/[slug]/[token]/      # public: a member's availability editor
│   ├── dashboard/              # authenticated: leader's bands
│   └── actions/                # Server Actions (bands, members, availability)
├── components/
│   ├── availability/            # WeeklyGrid, AggregateGrid, ExceptionsEditor
│   ├── marketing/                # landing page pieces
│   ├── dashboard/, join/, brand/
│   └── ui/                       # shadcn primitives
├── db/
│   ├── schema.ts                 # Drizzle schema (profiles, bands, band_members,
│   │                              # availability_weekly, availability_exceptions)
│   ├── migrations/                # generated SQL
│   ├── queries/                   # reusable read queries
│   └── seed.ts                    # demo band + members
├── lib/                            # constants, slug generator, supabase clients, utils
└── types/                          # shared TS types
supabase/migrations/                # RLS policies + auth trigger (Supabase-only)
```

## Notable implementation details

- **No login for band members.** A member's `member_token` (a random UUID)
  embedded in their personal URL is their entire authentication — every
  availability-writing Server Action re-validates that token against the
  `slug` in the URL before touching the database.
- **Weekly grid storage**: one row per `(member, day_of_week, time_block)`;
  a missing row means "not available" (the default), so most members only
  ever write a handful of rows.
- **Aggregate heatmap** is computed server-side per band by summing each
  member's weekly grid into `{available, maybe, unavailable, total}` counts
  per slot.
- **Joining is idempotent**: typing the same name (case-insensitively)
  twice on the same band's join link returns the same member and token
  instead of creating a duplicate.
