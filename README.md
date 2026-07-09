# PromoVault

Trade Promotion Management (TPM) with integrated Product Information Management
(PIM) for cruise line marketing and revenue teams. PromoVault is the system of
record for every promotion ever run — what it offered, which voyages it applied
to, who it targeted, what legal disclaimers accompanied it, how it performed,
and where it sits in the approval pipeline.

Built with **Next.js 14 (App Router) · Drizzle ORM · PostgreSQL/Supabase ·
Tailwind CSS + shadcn/ui · Recharts**.

## Features

- **Dashboard** — live KPIs (active promos, pending approvals, voyages with no
  active promo, monthly bookings), promo calendar strip, status donut, top
  performers, recent activity feed.
- **Promotions** — full CRUD with a multi-section form, offer-type-aware
  fields, auto-save, filterable/sortable list, full-text search, bulk status
  changes, CSV export, and a 10-stage approval workflow with role-gated
  transitions and launch-readiness checks.
- **Voyage linking** — two-panel bulk add/remove of sailings per promo (batch
  inserts), per-voyage offer overrides, and 5+ active promo conflict warnings.
- **Voyage catalog (PIM)** — every sailing as a product with cabin categories,
  occupancy, flexible metadata attributes, and the query the spreadsheet era
  never allowed: *every promotion ever attached to a voyage*.
- **Ship catalog, disclaimer library (versioned, draft → approved → retired),
  audience segments** with usage counts and a criteria builder.
- **Calendar** — month/quarter timeline of sell windows in region or ship swim
  lanes, color-coded by status, with over-promotion density warnings.
- **Reports** — performance table, revenue by offer type, booking lift vs
  baseline, promo density by region heatmap, CSV export.
- **Global search** — ⌘K palette across promos, voyages, ships, and
  disclaimers backed by Postgres full-text search + pg_trgm.
- **Audit trail** — every mutation logs who/what/when with field-level diffs.

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
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/promovault
```

Without Supabase configured, the middleware skips login and dev mode falls
back to the seeded admin user, so you can explore the app immediately.

### 3. Migrate

```bash
npm run db:migrate
# or apply the SQL directly:
#   psql "$DATABASE_URL" -f src/db/migrations/0000_init.sql
#   psql "$DATABASE_URL" -f src/db/migrations/0001_search_vector.sql
```

On Supabase, additionally run `supabase/migrations/20260101000000_rls_policies.sql`
(SQL editor or `supabase db push`) to enable RLS, the signup-profile trigger,
and the `auth.users` foreign key.

### 4. Seed

```bash
npm run db:seed   # = npx tsx src/db/seed.ts
```

Generates a deterministic (seeded RNG) 2+ year history: **17 ships, 16 regions,
~1,900 voyages (2025–2027), 220 promotions, ~14,700 promo-voyage links, 14
disclaimers, 14 audience segments, ~500 performance rows, ~1,300 audit
entries**, and 5 test users:

| Email | Role | Password (Supabase only) |
|---|---|---|
| admin@promovault.test | Admin | `PromoVault1!` |
| manager@promovault.test | Manager | `PromoVault1!` |
| coordinator1@promovault.test | Coordinator | `PromoVault1!` |
| coordinator2@promovault.test | Coordinator | `PromoVault1!` |
| analyst@promovault.test | Analyst | `PromoVault1!` |

With Supabase configured, the seed creates these as real auth users via the
admin API. Statuses like `live`/`expired` are anchored to the date you run the
seed, so the dashboard is always "current."

### 5. Run

```bash
npm run dev      # http://localhost:3000
npm run build && npm start   # production
```

## Roles

| Role | Create/edit | Approve/launch | Delete | Reports |
|---|---|---|---|---|
| Admin | ✓ | ✓ | ✓ | ✓ |
| Manager | ✓ | ✓ | — | ✓ |
| Coordinator | ✓ | — | — | — |
| Analyst | — | — | — | ✓ |
| Viewer | — | — | — | — |

New signups start as `viewer`; admins promote them in **Settings**.

## Project layout

```
src/
├── app/
│   ├── (app)/            # Authenticated app: dashboard, promotions, voyages,
│   │                     # ships, disclaimers, audiences, calendar, reports, settings
│   ├── (auth)/           # login / signup
│   ├── actions/          # Server Actions (mutations + audit logging + role checks)
│   └── api/              # search, voyages, promotions, disclaimers, reports
├── components/           # ui/ (shadcn primitives) + feature components
├── db/
│   ├── schema.ts         # Drizzle schema (all tables)
│   ├── migrations/       # generated SQL + full-text search migration
│   ├── queries/          # reusable read queries
│   └── seed.ts           # deterministic realistic seed
├── hooks/                # useAuth, useDebounce, usePromoFilters
├── lib/                  # constants, supabase clients, search, utils
└── types/                # shared TS types + JSONB shapes
supabase/migrations/      # RLS policies + auth trigger (Supabase-only)
```

## Notable implementation details

- **Full-text search** uses a `STORED` generated `tsvector` column on
  `promotions` (raw SQL migration — includes an `IMMUTABLE` wrapper around
  `array_to_string` for the tags array) plus `pg_trgm` GIN indexes for fuzzy
  voyage/ship matching.
- **Date-range overlap** queries follow the
  `sell_start_date <= :to AND sell_end_date >= :from` pattern with a composite
  index on both columns.
- **Bulk voyage linking** always uses batched multi-row inserts with
  `ON CONFLICT DO NOTHING` — never row-at-a-time loops.
- **Cascade deletes**: removing a promotion cleans up its voyage, disclaimer,
  and audience links (guarded by an explicit confirmation dialog, admin-only).
- **Status workflow** transitions are validated server-side
  (`STATUS_TRANSITIONS`), approval/launch is manager+ only, and `approved →
  live` requires linked voyages, a disclaimer, and an audience.
- Every mutation writes an `activity_log` row with `{field: {old, new}}` diffs.
