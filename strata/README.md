# Strata

Structured work management: user-defined **Item Types** with typed fields, three
independent organising axes (work hierarchy, category trees, variant
inheritance), and a spreadsheet-grade **grid** with preview-before-commit and
undo-after-commit on every write.

Built with Next.js 15 (App Router) · React 19 · TypeScript strict · Drizzle ORM ·
PostgreSQL 16 · Tailwind v4 · TanStack Table/Virtual/Query · Zustand · Zod.

---

## Three invariants

Everything else in this codebase is negotiable. These are not.

**1. The grid is the product.** Not a table with editable cells — a spreadsheet.
Keyboard navigation, rectangle selection, Excel-compatible clipboard, fill-down,
undo. It is built before trees and variants because it is the highest-risk
component and everything else is conventional CRUD.

**2. Preview before, undo after.** Every mutation touching data routes through a
**change set**: created in `preview` status, showing exactly what will change,
committed explicitly, undoable afterwards. Single-cell edits take the same path
with `item_count = 1` and auto-commit, which is what makes `Ctrl+Z` behave
identically for one cell and for a 300-row bulk edit.

**3. Tenant isolation lives in the database.** Every tenant table carries
`workspace_id` and a Postgres RLS policy. Every request runs inside
`withWorkspace()`, which opens a transaction and pins the workspace with
`set_config('app.workspace_id', …, true)` — transaction-scoped, never
session-scoped. See [Tenant isolation](#tenant-isolation) below; the constraints
there are not optional.

---

## Getting started

### 1. Install

```bash
npm install
cp .env.example .env
```

### 2. Start Postgres and Redis

```bash
docker compose up -d
```

Postgres must have `ltree`, `pg_trgm`, and `pgcrypto`. The compose file installs
them on first boot; `npm run db:migrate` also creates them idempotently, so an
existing database works too.

If you are running Postgres outside Docker, point `DIRECT_DATABASE_URL` at it as
a superuser and read the next section before setting `DATABASE_URL`.

### 3. Migrate and seed

```bash
CREATE_LOCAL_APP_ROLE=1 npm run db:migrate
npm run db:seed
```

`CREATE_LOCAL_APP_ROLE=1` gives the `strata_app` role a password so it can log
in locally. Only do this in development — real environments provision that role
out of band with a managed secret.

### 4. Run

```bash
STRATA_DEV_USER=alice@northwind.test npm run dev
```

Then open **http://localhost:3000/w/northwind**.

`STRATA_DEV_USER` is the local auth fallback for running without a Supabase
project. It only works when `NODE_ENV !== 'production'` *and* Supabase is
unconfigured, and it is inert in a production build. Seeded addresses:
`alice@northwind.test` (owner), `bob@` (member), `carol@` (viewer),
`dana@client.test` (guest).

```bash
npm run typecheck
npm run lint
npm test
```

### Troubleshooting

**`AggregateError` / "An error occurred in the Server Components render but no
message was provided".** This is the database being unreachable. Next.js masks
Server Component error messages in the browser by design, so the real error
(usually `ECONNREFUSED`) appears only in the terminal running `npm run dev`.

The workspace shell now diagnoses this before touching any data and renders the
specific fix instead of crashing, so you should see a setup page rather than
that error. If you do hit it, the two usual causes are:

- **Postgres is not running.** `docker compose up -d` exits successfully even
  when Docker itself is not started — check with `docker compose ps`.
- **The migration was run without `CREATE_LOCAL_APP_ROLE=1`.** The app connects
  as `strata_app`, which has no password until that flag creates one. See
  [Tenant isolation](#tenant-isolation) for why it does not connect as the owner.

**Connections fail on `localhost` but work on `127.0.0.1`.** Node resolves
`localhost` to both `::1` and `127.0.0.1`; if Postgres binds only IPv4, the IPv6
attempt fails and the driver reports an `AggregateError` covering both. The
`.env.example` uses `127.0.0.1` for this reason.

---

## Tenant isolation

This is the part that is easy to get subtly, invisibly wrong, so it is worth
reading before touching data access.

**The app connects as a non-owner role.** `DATABASE_URL` points at `strata_app`,
which owns no tables and has neither `SUPERUSER` nor `BYPASSRLS`. This matters
because **table owners bypass RLS by default and superusers bypass it
unconditionally** — an application connecting as the owner has policies that are
purely decorative, and every isolation test would pass against a database with
no policies at all. `tests/integration/tenantIsolation.test.ts` asserts the test
connection is not privileged, precisely so the suite cannot become theatre.

**Migrations connect as the owner.** `DIRECT_DATABASE_URL` is a direct superuser
connection, used only by `db:migrate` and `db:seed`. DDL is unaffected by RLS,
and the seed deliberately bypasses it.

**`SET LOCAL`, never `SET`.** A session-scoped GUC survives on a pooled
connection after the transaction ends and hands one tenant's context to whoever
picks that connection up next. `withWorkspace()` uses
`set_config(name, value, true)` — the third argument is what makes it
transaction-scoped. An ESLint rule fails the build on a `SET x = …` string
literal.

**Fail closed.** With no workspace pinned, `current_setting('app.workspace_id',
true)` is NULL, `workspace_id = NULL` is NULL, and every policy denies. A
forgotten context yields zero rows, never another tenant's rows.

**The seed makes both workspaces look alike** — same client names, same project
titles, users who belong to both. A fixture with obviously distinct data would
make a leak look like a normal result.

---

## Layout

```
src/
  app/                 routes — (auth), (app)/w/[slug]/…, api/v1/…
  server/
    db/                drizzle schema, withWorkspace(), migrations, seed
    services/          ALL business logic. changeSets.service.ts is the write path.
    search/            filter compiler, projection index, search provider
    validation/        the 14 field types; dynamic Zod schema compilation
    jobs/              Inngest functions
    lib/               ltree path math, fractional indexing, errors, redis
  components/
    grid/              the hard part — selection, keyboard, clipboard, fill, undo
    type-builder/      Item Type builder and the starter presets
  types/               shared domain types, field types, filter AST
tests/
  unit/ property/ integration/ perf/ e2e/
```

**Conventions**

- Every query runs inside `withWorkspace()`. A query outside it is a bug, not an
  exception.
- Business logic lives in `src/server/services/`. Route handlers validate input
  with Zod, call `can()`, call a service, and shape the response — nothing else.
- Writes go through change sets, including "quick" internal updates.
- Services throw typed `AppError`; the route layer renders the standard
  envelope. A raw Postgres error must never reach a client.
- `item_field_index` is **derived**. It must stay rebuildable from
  `effective_values` alone.

---

## Testing

| Command | What it covers |
| --- | --- |
| `npm run test:unit` | Field coercion, ltree path math, fractional indexing, permissions, completeness |
| `npm run test:integration` | Tenant isolation, change-set undo fidelity, projection consistency |
| `npm run test:perf` | 100k-item fixture with `EXPLAIN` assertions |
| `npm run test:e2e` | Playwright: signup, grid paste, bulk edit + undo, import |

Integration tests need the local database migrated and seeded.

---

## Documentation

| Document | Owns |
| --- | --- |
| [`CLAUDE.md`](CLAUDE.md) | The build instructions. Read first. |
| [`docs/PRD.md`](docs/PRD.md) | Why the product exists, personas, acceptance criteria, success metrics |
| [`docs/TECH_SPEC.md`](docs/TECH_SPEC.md) | Data model, architecture decisions, performance budgets, testing strategy |
| [`docs/API_DESIGN.md`](docs/API_DESIGN.md) | Endpoint contracts, filter grammar, error codes, webhooks |
| [`docs/UI_UX_NOTES.md`](docs/UI_UX_NOTES.md) | Screens, design tokens, the normative grid keyboard map |
| [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md) | Ship gates, with 🔒 blockers marked |

### ⚠️ Read this before continuing the build

[`docs/SPEC_RECONCILIATION.md`](docs/SPEC_RECONCILIATION.md) records where the current code diverges
from the specifications above. Steps 1–7 were implemented before the companion documents were
available, so their contents were inferred from `CLAUDE.md`'s descriptions of them.

Most of the divergence is cosmetic or a defensible alternative, but three items are genuine
correctness problems — most importantly, **variant inheritance is implemented backwards** relative to
Tech Spec §2.5. Fix that before building anything else on top of variants.
