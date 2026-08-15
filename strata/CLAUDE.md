# CLAUDE.md — Strata

> This file is the primary instruction set for Claude Code.
> **Read it fully before writing any code.** Companion docs live in `docs/`:
> [`docs/PRD.md`](docs/PRD.md) (why), [`docs/TECH_SPEC.md`](docs/TECH_SPEC.md) (data model + architecture detail),
> [`docs/API_DESIGN.md`](docs/API_DESIGN.md) (endpoint contracts), [`docs/UI_UX_NOTES.md`](docs/UI_UX_NOTES.md) (screens + interaction spec),
> [`docs/LAUNCH_CHECKLIST.md`](docs/LAUNCH_CHECKLIST.md) (ship gates).
>
> **Before continuing an in-progress build, read [`docs/SPEC_RECONCILIATION.md`](docs/SPEC_RECONCILIATION.md).**
> The first build pass was written before the companion docs were available and
> diverges from them in ways that are cheap to fix now and expensive later —
> including one inverted semantic in variant inheritance.

---

## Project Overview

**What this app does:** Strata is a web-based work-management platform (a Monday.com / ClickUp / Jira competitor) built on a PIM-style structured data model. Teams define reusable **Item Types** with custom typed fields, organize items across three independent axes (work hierarchy, category trees, variant inheritance), and edit hundreds of items at a time in a spreadsheet-grade **grid view** with preview-before-commit and undo-after-commit.

**Who it's for:** Non-technical ops leads at 20–150 person agencies and marketing/ops teams whose work is a nested hierarchy of items, not a flat task list — and who have outgrown Monday/ClickUp but will not adopt Jira or Akeneo.

**MVP scope — what must work at the end of a successful build:**

1. A user signs up, lands in a workspace, and creates a custom Item Type from a preset **in under two minutes**.
2. They create items, nest them in a work hierarchy, and classify them into a custom category tree.
3. They open the **grid view** and edit inline with full keyboard nav, multi-cell selection, copy/paste to and from Excel, fill-down, and undo.
4. They select 50 rows, bulk-set a field, **see a preview of the change**, commit, and **undo it** from a toast.
5. They import a CSV, map columns, save the mapping as a profile, review a dry-run report, and commit.
6. They define a variant axis on an Item Type, generate per-region variants, edit a shared field on the model, and watch it propagate.
7. Every item shows a **completeness %**; views can filter to "incomplete only."
8. Grid, list, and board views all work over the same data, with saved views.
9. An invited Guest sees only their scoped tree branch.
10. `/api/v1` is the same API the app itself uses, documented and working.

**What is explicitly NOT in this build:** see [Out of Scope](#out-of-scope-for-this-build) at the bottom. Read that section before proposing anything not listed above.

---

## The Three Things That Matter Most

If you have to trade something away, protect these in this order.

### 1. The grid is the product

Not a table with editable cells — a spreadsheet. The user has Excel open beside this app right now and will compare within thirty seconds. **Build the grid first**, before trees and variants, because it is the highest-risk component in the codebase and everything else is conventional CRUD. If the grid spike slips, cut Board view before you cut grid fidelity.

The keyboard map in **UI/UX Notes §5.1 is normative** — implement it exactly. Partial fidelity is the failure mode.

### 2. Preview before, undo after — with no exceptions

Every mutation touching more than one item routes through a **Change Set**: created in `preview` status, showing exactly what will change, committed explicitly, undoable afterward. This is not a feature you add at the end. It is the write path. Build `change_sets` in Step 4, before any feature that writes data, and route every write through it including single-cell edits and imports.

### 3. Tenant isolation is enforced in the database

Every tenant table has `workspace_id` and a Postgres RLS policy. Every request runs in a transaction that begins with `SET LOCAL app.workspace_id`. **`SET LOCAL`, never `SET`** — session-scoped state leaks across pooled connections and becomes a cross-tenant data leak. Write the isolation test in Step 2, before there is anything to leak.

**The app must connect as a non-owner role.** Table owners bypass RLS by default and superusers bypass it unconditionally, so an app connecting as the owner has policies that are decorative — and every isolation test would pass against a database with no policies at all. Assert in the test suite that the test connection has neither `SUPERUSER` nor `BYPASSRLS`.

---

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript **strict** | One deployable. Server Components for shell/detail, Client Components for grid. |
| Grid | TanStack Table v8 + TanStack Virtual v3 | Headless. Selection, clipboard, and fill are hand-written — do not reach for a batteries-included data grid, it will fight you. |
| Server state | TanStack Query v5 | Optimistic updates, keyed by `[workspace, itemType, viewHash]`. |
| Client state | Zustand | Grid selection rectangle + edit buffer + undo stack. **Not** React state — see [Gotchas](#gotchas--watch-outs). |
| Styling | Tailwind CSS v4 + shadcn/ui | shadcn is copy-in; modify freely for dense grid chrome. |
| Validation | Zod | Shared client/server. Dynamic user fields compile to Zod at runtime. |
| Database | PostgreSQL 16 (Supabase) | JSONB + GIN + ltree + RLS. All four are load-bearing. |
| ORM | Drizzle ORM + Drizzle Kit | Typed schema/migrations; raw `sql` templates for recursive CTEs and the filter compiler. |
| Auth | Supabase Auth | Email/password, magic link, Google. JWT in httpOnly cookie. |
| Jobs | Inngest v3 | Bulk >500, imports, exports, variant propagation, webhooks. |
| Cache / limits | Upstash Redis | Rate limiting, idempotency keys, compiled-filter caching. |
| Storage | Supabase Storage | Import uploads, export files. |
| Email | Resend + React Email | Transactional only. |
| Hosting | Vercel + Supabase + Upstash + Inngest | |
| Testing | Vitest, fast-check, Testcontainers, Playwright | |
| Monitoring | Sentry, PostHog | Strip item content from both — see [Gotchas](#gotchas--watch-outs). |

---

## File & Folder Structure

```
strata/
├── README.md
├── CLAUDE.md                            # this file
├── docs/                                # PRD · TECH_SPEC · API_DESIGN · UI_UX_NOTES · LAUNCH_CHECKLIST
├── .env.example
├── package.json
├── drizzle.config.ts
├── next.config.ts
├── tailwind.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── docker-compose.yml                   # local Postgres 16 + Redis
├── drizzle/
│   ├── migrations/                      # generated SQL, never edited after merge
│   └── meta/
├── src/
│   ├── app/
│   │   ├── (marketing)/                 # landing, pricing — minimal in v1
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   ├── signup/page.tsx
│   │   │   └── invite/[token]/page.tsx
│   │   ├── (app)/
│   │   │   └── w/[slug]/
│   │   │       ├── layout.tsx           # sidebar shell, workspace context
│   │   │       ├── page.tsx             # workspace home
│   │   │       ├── types/
│   │   │       │   ├── page.tsx         # item type list
│   │   │       │   └── [typeId]/
│   │   │       │       ├── page.tsx     # default view redirect
│   │   │       │       ├── builder/page.tsx
│   │   │       │       └── v/[viewId]/page.tsx   # grid | list | board
│   │   │       ├── items/[itemId]/page.tsx       # full-page detail (deep link)
│   │   │       ├── trees/page.tsx
│   │   │       ├── import/page.tsx
│   │   │       ├── activity/page.tsx
│   │   │       └── settings/
│   │   │           ├── members/page.tsx
│   │   │           ├── api-keys/page.tsx
│   │   │           └── webhooks/page.tsx
│   │   ├── share/[token]/page.tsx        # public shared view (READ-ONLY, no auth)
│   │   └── api/
│   │       ├── v1/                       # THE api — app and customers use the same routes
│   │       │   ├── auth/[...]/route.ts           # signup · login · logout · me
│   │       │   ├── workspaces/[...]/route.ts
│   │       │   ├── item-types/[...]/route.ts
│   │       │   ├── field-groups/[...]/route.ts
│   │       │   ├── fields/[...]/route.ts
│   │       │   ├── items/[...]/route.ts
│   │       │   ├── change-sets/[...]/route.ts
│   │       │   ├── trees/[...]/route.ts
│   │       │   ├── tree-nodes/[...]/route.ts
│   │       │   ├── views/[...]/route.ts
│   │       │   ├── imports/[...]/route.ts
│   │       │   ├── import-profiles/[...]/route.ts
│   │       │   ├── exports/[...]/route.ts
│   │       │   ├── members/[...]/route.ts
│   │       │   ├── notifications/[...]/route.ts
│   │       │   ├── api-keys/[...]/route.ts
│   │       │   └── webhooks/[...]/route.ts
│   │       ├── health/route.ts           # uptime probe — unauthenticated, no tenant context
│   │       ├── inngest/route.ts          # job handler mount
│   │       └── openapi/route.ts          # generated spec
│   ├── server/
│   │   ├── db/
│   │   │   ├── index.ts                  # drizzle client + withWorkspace() tx wrapper
│   │   │   ├── schema/                   # one file per domain, re-exported
│   │   │   └── seed.ts
│   │   ├── services/                     # ALL business logic lives here
│   │   │   ├── itemTypes.service.ts
│   │   │   ├── fields.service.ts
│   │   │   ├── items.service.ts
│   │   │   ├── changeSets.service.ts     # ← the write path. Start here.
│   │   │   ├── variants.service.ts
│   │   │   ├── completeness.service.ts
│   │   │   ├── trees.service.ts
│   │   │   ├── views.service.ts
│   │   │   ├── imports.service.ts
│   │   │   ├── exports.service.ts
│   │   │   ├── permissions.service.ts    # the single can() function
│   │   │   └── webhooks.service.ts
│   │   ├── search/
│   │   │   ├── SearchProvider.ts         # interface — keeps the escape hatch open
│   │   │   ├── PostgresSearchProvider.ts
│   │   │   ├── filterCompiler.ts         # FilterGroup AST → parameterized SQL
│   │   │   └── projection.ts             # item_field_index maintenance
│   │   ├── validation/
│   │   │   ├── fieldTypes.ts             # the 14 types: coerce, validate, format
│   │   │   └── dynamicSchema.ts          # Item Type → Zod schema, Redis-cached
│   │   ├── jobs/                         # Inngest functions
│   │   │   ├── bulkCommit.ts
│   │   │   ├── importValidate.ts
│   │   │   ├── importCommit.ts
│   │   │   ├── exportGenerate.ts
│   │   │   ├── variantPropagate.ts
│   │   │   ├── fieldBackfill.ts
│   │   │   ├── webhookDeliver.ts
│   │   │   └── projectionAudit.ts        # nightly 1% consistency sample
│   │   ├── auth/
│   │   │   ├── session.ts
│   │   │   ├── apiKeys.ts
│   │   │   └── middleware.ts
│   │   └── lib/
│   │       ├── ltree.ts                  # path math — encode/decode/reparent
│   │       ├── fractionalIndex.ts        # sibling ordering
│   │       ├── ratelimit.ts
│   │       ├── redis.ts
│   │       └── errors.ts                 # AppError + the standard error shape
│   ├── components/
│   │   ├── ui/                           # shadcn primitives
│   │   ├── grid/                         # ← the hard part. Keep it self-contained.
│   │   │   ├── Grid.tsx
│   │   │   ├── GridCell.tsx              # memo'd on (value, isSelected, isEditing)
│   │   │   ├── GridHeader.tsx
│   │   │   ├── GridRow.tsx
│   │   │   ├── useGridSelection.ts       # rectangle selection
│   │   │   ├── useGridKeyboard.ts        # the full key map (UI/UX §5.1)
│   │   │   ├── useGridClipboard.ts       # TSV read/write, Excel interop
│   │   │   ├── useGridFill.ts            # fill-down + fill-handle drag
│   │   │   ├── useGridUndo.ts            # local stack → change sets
│   │   │   └── editors/                  # one per field type — all 14
│   │   ├── board/
│   │   ├── list/
│   │   ├── item-detail/
│   │   │   ├── ItemDetailPanel.tsx
│   │   │   ├── CompletenessIndicator.tsx
│   │   │   ├── VariantBanner.tsx         # "inherited from" + override/revert
│   │   │   └── ActivityFeed.tsx
│   │   ├── type-builder/
│   │   │   ├── ItemTypeBuilder.tsx
│   │   │   ├── FieldRow.tsx
│   │   │   ├── AdvancedSection.tsx       # collapsed by default. Always.
│   │   │   └── presets.ts                # the starter Item Types
│   │   ├── trees/
│   │   ├── import/
│   │   ├── change-set/
│   │   │   ├── ChangeSetPreview.tsx      # the preview modal
│   │   │   └── UndoToast.tsx
│   │   └── concept-hints/                # in-product "why would I use this"
│   ├── hooks/
│   ├── lib/
│   │   ├── api.ts                        # typed client — ALL fetches go through here
│   │   └── utils.ts
│   └── types/
│       ├── index.ts                      # shared domain types
│       ├── fields.ts                     # FieldType union + config shapes
│       └── filters.ts                    # FilterGroup / FilterClause
├── tests/
│   ├── unit/
│   ├── property/
│   ├── integration/                      # Testcontainers Postgres
│   ├── perf/                             # 100k-item fixture + EXPLAIN assertions
│   └── e2e/                              # Playwright
└── emails/                               # React Email templates
```

---

## Build Steps

Follow these **in order**. Do not skip ahead. Steps 1–5 are foundation; nothing built after them is safe if they are wrong.

### Step 1: Scaffolding
- [ ] `npx create-next-app@latest strata --typescript --tailwind --app --eslint`
- [ ] Set `"strict": true` and `"noUncheckedIndexedAccess": true` in `tsconfig.json`
- [ ] Install: `drizzle-orm postgres drizzle-kit zod @tanstack/react-table @tanstack/react-virtual @tanstack/react-query zustand @supabase/supabase-js @supabase/ssr @upstash/redis @upstash/ratelimit inngest resend date-fns lucide-react`
- [ ] Dev deps: `vitest @vitest/coverage-v8 fast-check @testcontainers/postgresql @playwright/test @axe-core/playwright prettier eslint-config-prettier`
- [ ] `npx shadcn@latest init`, then add: `button input select dialog dropdown-menu popover command toast table tabs checkbox badge avatar tooltip sheet separator scroll-area`
- [ ] `docker-compose.yml` with Postgres 16 (`ltree` + `pg_trgm` enabled) and Redis
- [ ] `.env.example` with every variable from Tech Spec §4
- [ ] ESLint rules: ban `dangerouslySetInnerHTML`; ban string concatenation inside `sql` tagged templates
- [ ] Prettier + `lint-staged` pre-commit hook
- [ ] Verify: `npm run dev` serves a page, `npm run typecheck` and `npm run lint` are clean

### Step 2: Database, Schema, and Tenant Isolation
Implement the full data model from Tech Spec §2. Do not abbreviate it — the later steps assume every column exists.

- [ ] Enable extensions: `CREATE EXTENSION IF NOT EXISTS ltree; CREATE EXTENSION IF NOT EXISTS pg_trgm;`
- [ ] Drizzle schema files for: `workspaces`, `users`, `workspace_members`, `guest_scopes`, `item_types`, `field_groups`, `fields`, `items`, `item_field_index`, `trees`, `tree_nodes`, `item_tree_nodes`, `change_sets`, `change_entries`, `views`, `import_profiles`, `import_jobs`, `api_keys`, `webhooks`, `webhook_deliveries`, `notifications`
- [ ] All indexes from Tech Spec §2, including the GiST indexes on `items.path` and `tree_nodes.path`, the trigram index on `items.search_text`, the `jsonb_path_ops` GIN on `effective_values`, the keyset index, and the partial indexes on `item_field_index`
- [ ] The two CHECK constraints on `items` (a variant model is neither a variant child nor a work-hierarchy child)
- [ ] RLS: enable on every tenant table, policy `USING`/`WITH CHECK` on `current_setting('app.workspace_id', true)::uuid`
- [ ] `src/server/db/index.ts` exports **`withWorkspace(workspaceId, fn)`** — opens a transaction, runs `SET LOCAL app.workspace_id`, invokes `fn` with the tx handle. **Every** data access goes through it. No exceptions, ever.
- [ ] `src/server/lib/ltree.ts`: uuid→label encoding (hyphens become underscores; ltree labels can't contain `-`), path build, subtree reparent SQL, cycle detection
- [ ] `src/server/lib/fractionalIndex.ts`: midpoint ordering for sibling drag
- [ ] `seed.ts`: two workspaces with overlapping-looking data, several item types, a nested tree, ~200 items — this seed is what the isolation test runs against
- [ ] **Write the tenant isolation test now** (Tech Spec §8, test 1). Include a query with a deliberately omitted `WHERE workspace_id` and assert it returns zero foreign rows. This test guards the highest-consequence invariant in the codebase.
- [ ] Verify: migrations apply cleanly to an empty DB; isolation test passes

### Step 3: Auth, Workspace Context, Permissions
- [ ] Supabase Auth: signup, login, magic link, Google OAuth, password reset
- [ ] `@supabase/ssr` cookie session handling in middleware
- [ ] Middleware chain: authenticate → resolve workspace → verify membership → attach `{user, workspace, role}` → rate limit
- [ ] Workspace creation on first signup, with the built-in tree and default Item Types seeded
- [ ] Invite flow: create pending `workspace_members` row → Resend email → accept via token
- [ ] `permissions.service.ts` exporting a single **`can(actor, action, resource): true | DenialReason`** implementing the Tech Spec §3.1 matrix, including guest tree-node scoping
- [ ] `AppError` + the standard error envelope from API Design §10; every denial returns a specific message, never a silent no-op
- [ ] API key auth: generate, SHA-256 + pepper, prefix display, scope check, **reject any API key whose member role is `guest`**
- [ ] Verify: E2E signup → workspace → invite a second user → each role sees exactly what the matrix says

### Step 4: Change Sets — the write path
**Build this before any feature that writes data.** Everything downstream depends on it.

- [ ] `changeSets.service.ts`:
  - `preview(operation, target, patch)` → resolves affected items, computes per-entry `before`/`after`, evaluates permission/validation skips, persists `status='preview'` with a summary + 20 sample rows. Writes nothing to `items`.
  - `commit(changeSetId)` → one transaction: apply entries; update `values`, `effective_values`, `item_field_index`, `completeness_pct`, `missing_required`, `search_text`, `path`. Compare each entry's `before` against current; mismatch → fail whole commit with `STALE_PREVIEW`.
  - `undo(changeSetId)` → build the inverse set, `source='undo'`, `parent_change_set_id` set, commit it, mark the original `undone`.
- [ ] The 9 v1 operations: `create`, `set_field`, `clear_field`, `change_type`, `reparent`, `tree_assign`, `tree_unassign`, `delete`, `assign_user`. (A tenth enum value, `variant_propagate`, is system-only — never user-initiated.)
- [ ] Single-item writes take the same path with `item_count=1` and auto-commit (no preview). **This is what makes `Ctrl+Z` behave identically for one cell and for 300 rows.**
- [ ] Idempotency keys via Redis, honored on preview and commit
- [ ] `> BULK_SYNC_THRESHOLD` (500) items → hand off to the `bulkCommit` Inngest job with progress
- [ ] **Write the undo fidelity test now** (Tech Spec §8, test 2): for each operation, snapshot → apply → undo → deep-equal, including `effective_values`, `item_field_index`, `completeness_pct`, and `path`
- [ ] Verify: all 9 operations preview correctly and undo to a byte-identical state

### Step 5: Item Types, Fields, Validation, Completeness
- [ ] CRUD for `item_types`, `field_groups`, `fields`
- [ ] All 14 field types in `validation/fieldTypes.ts`, each with `coerce`, `validate`, `format`, and `toIndexColumn` (which of the `item_field_index` value columns it lands in)
- [ ] `dynamicSchema.ts`: Item Type → Zod schema, cached in Redis 5 min, invalidated on schema mutation
- [ ] **Non-blocking validation:** a value failing coercion writes to `items.invalid_values[field_key]` with a message; every other field on the item still commits. This is a PRD requirement (§6.4), not a nicety.
- [ ] Field type change with a conversion preview (clean / coerced / preserved-as-text counts)
- [ ] Field soft-delete with a 30-day restore path; values retained
- [ ] Immutable `key`, mutable `label` — renaming must never touch stored data
- [ ] `completeness.service.ts`: pct + `missing_required[]` from `effective_values`, recomputed inside every change-set commit. **Completeness counts required fields only** (PRD §4.7).
- [ ] `presets.ts`: **Task, Client Project, Campaign, Product Variant, Structured Record, Blank** — field sets specified in UI/UX Notes §3.2
- [ ] Verify: create a type from each preset; add/rename/retype/delete fields; completeness updates on every write

### Step 6: Items, Hierarchy, and the Projection Index
- [ ] Item CRUD through change sets
- [ ] Work hierarchy: `parent_id` + `path` + `depth` maintenance, subtree reparent in one SQL statement, cycle rejection with `HIERARCHY_CYCLE`
- [ ] Sibling ordering via fractional index
- [ ] `projection.ts`: maintain `item_field_index` transactionally, writing only *changed* fields; `is_indexed` auto-enabled on first filter/sort of a field, triggering `fieldBackfill`
- [ ] `search_text` maintenance from `title` + searchable fields
- [ ] `filterCompiler.ts` per Tech Spec §6.2 — `EXISTS` subqueries against `item_field_index`, bound parameters only, field key → `field_id` resolved through the schema, **no string concatenation path exists**
- [ ] `PostgresSearchProvider` behind the `SearchProvider` interface
- [ ] Keyset pagination (never `OFFSET`)
- [ ] **Write the projection consistency test now** (Tech Spec §8, test 3)
- [ ] Verify: 100k seeded items, filters return correct results, `EXPLAIN` shows no seq scan on `items`

### Step 7: Grid View — the hard part
Budget the most time here. Build in this order; each substep is independently verifiable.

- [ ] **7a. Render.** TanStack Table + Virtual, 10k rows, 60fps scroll. Cells memo'd on `(value, isSelected, isEditing)`. Measure with React DevTools Profiler before moving on.
- [ ] **7b. Selection.** `useGridSelection` in Zustand. Single cell, shift-click range, drag rectangle, Ctrl/Cmd+A. Cells subscribe to a *slice*, never the whole store. Selection count readout ("42 cells, 12 rows").
- [ ] **7c. Keyboard.** `useGridKeyboard`, the exact map in UI/UX Notes §5.1 — every binding, including `Ctrl/⌘+Enter`, `Space`, `/`, and `Ctrl/⌘+K`.
- [ ] **7d. Editing.** One editor component per field type — all 14. Commit on Enter/Tab/blur; cancel on Esc. Optimistic local write → change set → rollback with an inline error on failure.
- [ ] **7e. Clipboard.** `useGridClipboard`. Copy writes TSV (and `text/html`). Paste parses TSV, maps onto the selection rectangle, coerces per column type, and previews non-convertible values before committing. **Test against real Excel and real Google Sheets on both macOS and Windows.**
- [ ] **7f. Fill.** Ctrl/Cmd+D fill-down; drag the bottom-right fill handle. Increment detection for numbers and dates.
- [ ] **7g. Undo.** `useGridUndo`: a local stack of ≥ 50 operations mapping to change-set undos.
- [ ] **7h. Columns.** Reorder by drag, resize, pin/freeze leading columns, show/hide via the field picker, persist into `views.config`.
- [ ] **7i. Grouping.** Group by any field, collapsible groups, per-group aggregates (count, sum, avg, % complete).
- [ ] **7j. Completeness column** with a compact bar + %.
- [ ] Verify: E2E paste of a 100×10 TSV block; 60fps at 10k rows; undo restores exactly.

### Step 8: List View, Board View, Item Detail Panel
- [ ] List: rows with a hierarchy-indent expander; inline edit of the primary fields; shares filters and sort with grid
- [ ] Board: group by any `select` or `user` field; drag between columns writes the field via a change set; per-column count and WIP display
- [ ] Item detail panel: side panel on desktop, full screen on tablet, deep-linkable at `/w/:slug/items/:id`
- [ ] Detail shows: fields by field group (collapsible), completeness with click-to-focus missing-field links, hierarchy breadcrumb, tree membership chips, variant banner, activity feed
- [ ] View switching preserves filters and sort
- [ ] Verify: same filter set produces the same item set in all three views

### Step 9: Category Trees
- [ ] Tree + node CRUD; arbitrary depth; drag reorder and reparent with `path` maintenance
- [ ] Built-in tree + one custom tree (v1 cap)
- [ ] Many-to-many membership; an item in multiple nodes across multiple trees
- [ ] Node selection filters items, with an include-descendants toggle
- [ ] Drag items from grid/list onto a node; bulk assign/unassign via change sets
- [ ] Node deletion prompts: unassign / move to parent / move to chosen node. **Never silently orphan items.**
- [ ] `item_count` denormalization maintained transactionally; descendant rollups in one grouped query
- [ ] Verify: subtree filter at depth 8 stays under 300ms on the 100k fixture

### Step 10: Variants
- [ ] `variant_axes` on Item Type, backed by `select` fields
- [ ] Per-field `inheritance`: `shared` | `variant` — **semantics are in Tech Spec §2.5 and are not what you would guess. Read them.**
- [ ] `variants.service.ts` implementing `computeEffectiveValues` exactly as written in Tech Spec §2.5
- [ ] Guided generation: pick axis values → preview the N variants → create, as one change set
- [ ] Model write → recompute model, then variants: ≤ `VARIANT_SYNC_THRESHOLD` (50) inline, above that via `variantPropagate` with a "propagating to N variants" indicator
- [ ] Override = key present in `variant.values` for a `variant`-inheritance field. Revert = delete the key. **No separate `is_overridden` flag** — it would drift.
- [ ] UI: inherited values visually distinct via **two channels** (color/weight *and* icon/bar), "inherited from [model]" affordance, explicit override action, one-click revert
- [ ] Enforce the v1 constraint: a variant model is not a work-hierarchy parent, variants have no children (the DB CHECKs back this up)
- [ ] Hard cap 200 variants per model, with a clear error
- [ ] Property test: any model/variant/override combination resolves consistently
- [ ] Verify: create 14 regional variants, edit a shared field on the model, confirm all 14 update and overridden ones do not

### Step 11: Import / Export
- [ ] Upload CSV/XLSX to Supabase Storage; magic-byte + MIME + extension check; 50MB cap; parse in a job, never in a request handler
- [ ] Header detection, 20-row preview
- [ ] Column mapping with fuzzy field-name suggestions and confidence indicators
- [ ] Save mapping as an `import_profile`, reusable
- [ ] `importValidate` job → row count, new vs. matched-existing via `match_key`, per-column coercion warnings, downloadable error CSV
- [ ] `importCommit` job → one change set (so imports are undoable like everything else)
- [ ] Export respects the current view's filters, sort, visible fields, and grouping; CSV + XLSX
- [ ] **CSV injection guard:** prefix `'` on any value starting with `=`, `+`, `-`, `@`, tab, or CR
- [ ] Exports > 5,000 rows run as a job with a notification + signed link
- [ ] Verify: round-trip 5,000 rows out and back in with no data loss; undo the import

### Step 12: Views, Sharing, Guests
- [ ] Save/load/rename/delete views; private | workspace | shared visibility
- [ ] View config persists filters, sort, visible fields, group-by, column widths and order
- [ ] Shared views get a `share_token` and a public `/share/[token]` route
- [ ] Guest invitation scoped to tree nodes via `guest_scopes`; enforced in `permissions.service.ts`. Guests edit only granted fields on in-scope items — no create, no delete, no bulk, no API
- [ ] `/share/[token]` is **read-only and unauthenticated**. A guest who needs to edit signs in through their invite and uses the normal app shell with a scoped sidebar
- [ ] **Render an explicit in-product warning wherever a view is shared externally: field subsetting is presentation, not security** (PRD §9 Risk 3, UI/UX §3.10)
- [ ] Verify: a guest sees only their scoped branch, in every view type, and their API key requests are rejected

### Step 13: Activity, Notifications, API, Webhooks
- [ ] Per-item activity feed from `change_entries`; workspace feed filterable by user, type, date
- [ ] In-app notification center with unread state
- [ ] Resend emails: invite, assignment, export ready, import done — with a digest option
- [ ] Complete `/api/v1` surface per `docs/API_DESIGN.md`
- [ ] OpenAPI spec generated from the Zod schemas at `/api/openapi`; contract tests fail the build on drift
- [ ] Webhooks: subscribe, HMAC-SHA256 signing, retry with exponential backoff, auto-disable after 20 consecutive failures
- [ ] Verify: the app's own screens make no API call that is not in the published spec

### Step 14: Polish, Accessibility, Concept Hints
- [ ] Loading, empty, and error states for every view — empty states **teach the concept** (UI/UX Notes §3)
- [ ] Concept hints for variants, trees, and completeness, per UI/UX Notes §7
- [ ] Progressive disclosure audit: Advanced collapsed by default everywhere; the 2-minute path never surfaces variant/completeness/permission config
- [ ] Responsive to tablet (768px); grid degrades to a horizontally-scrolling read-mostly table on phones
- [ ] Keyboard navigation for every interactive element; visible focus rings; ARIA grid roles; `aria-live` announcements for selection and bulk results
- [ ] Contrast AA throughout; run `@axe-core/playwright` on every major screen
- [ ] Command palette (Cmd+K): jump to view, item, or type
- [ ] 404, 500, and offline states; favicon, title, meta

### Step 15: Performance Verification
- [ ] Seed the 100k-item × 40-field fixture
- [ ] Assert every budget in Tech Spec §6.1. **A missed budget is a failed acceptance criterion, not a follow-up ticket.**
- [ ] `EXPLAIN` assertions in CI: any plan with a seq scan on `items` fails the build
- [ ] Lighthouse on the shell; bundle analysis; confirm the grid chunk is lazy-loaded
- [ ] Profile grid scroll at 10k rows and confirm 60fps

### Step 16: Deployment
- [ ] Supabase project, Upstash, Inngest, Resend, Sentry, PostHog provisioned
- [ ] Env vars set in Vercel per environment (production values never mirrored to preview)
- [ ] GitHub Actions pipeline per Tech Spec §9.2, with the migration approval gate
- [ ] PITR enabled; a restore rehearsed once on staging before launch
- [ ] Deploy staging, run the full E2E suite, then production
- [ ] Smoke test with a real signup on production

---

## Conventions

- **Naming:** `camelCase` for variables/functions, `PascalCase` for components/types, `SCREAMING_SNAKE` for constants. Components are `PascalCase.tsx`; everything else is `camelCase.ts`. Services are `<domain>.service.ts`. DB columns are `snake_case`; Drizzle maps them to `camelCase` in TS. **API request and response bodies are `snake_case`** (API Design §1.2) — map at the route boundary.
- **Data access:** every query runs inside `withWorkspace()`. If you find yourself writing a query outside it, you have found a bug, not an exception.
- **Business logic lives in services.** Route handlers do exactly four things: validate input with Zod, call `can()`, call a service, shape the response. A route handler containing a SQL query or a business rule is a defect.
- **API calls from the client** go through `src/lib/api.ts`. No bare `fetch` in a component.
- **Writes go through change sets.** A service that writes to `items` without a change set is a bug — including "quick" internal updates.
- **Errors:** throw a typed `AppError(code, message, details?)`. The route layer maps it to the standard envelope. Never leak a raw Postgres error to a client.
- **Types:** shared domain types in `src/types/`. Infer from Drizzle schema and Zod schemas rather than hand-writing duplicates.
- **Comments:** explain *why*, never *what*. The filter compiler, ltree path math, and variant resolution each get a header comment explaining the approach and what breaks if it's changed naively.
- **Commits:** conventional commits (`feat:`, `fix:`, `perf:`, `refactor:`, `test:`).
- **Tests colocate by kind**, not by file — `tests/unit`, `tests/integration`, etc. Every service gets integration coverage; the three named tests in Tech Spec §8 are non-negotiable.

---

## Environment Variables

```env
# Database
DATABASE_URL=                      # pooled (PgBouncer, transaction mode)
DIRECT_DATABASE_URL=               # direct — migrations only

# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=         # server only — never ships to the client
SUPABASE_STORAGE_BUCKET=strata-files

# Redis
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=

# Jobs
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# Email
RESEND_API_KEY=
EMAIL_FROM="Strata <no-reply@strata.app>"

# App
APP_URL=http://localhost:3000
API_KEY_PEPPER=                    # server-side pepper for API key hashing
WEBHOOK_SIGNING_VERSION=v1

# Tuning
BULK_SYNC_THRESHOLD=500            # above this, bulk commits go async
VARIANT_SYNC_THRESHOLD=50          # above this, variant propagation goes async
MAX_IMPORT_ROWS=50000

# Observability (optional in dev)
SENTRY_DSN=
NEXT_PUBLIC_POSTHOG_KEY=
```

---

## Gotchas & Watch-Outs

**`SET LOCAL`, never `SET`.** Session-scoped settings survive on pooled connections and will hand one tenant's context to another tenant's request. Transaction-scoped only, always inside `withWorkspace()`.

**Connect as a non-owner role.** Owners bypass RLS by default; superusers bypass it unconditionally. An app connecting as the owner has decorative policies and an isolation suite that proves nothing.

**Anything that reads a tenant table needs workspace context — including auth.** The membership lookup itself queries `workspace_members`, which is RLS-protected. Resolve the slug first, then pin the workspace, then read membership. API key resolution cannot do that (the key is how you learn the workspace) and needs a `SECURITY DEFINER` function with a pinned `search_path`.

**ltree labels cannot contain hyphens.** UUIDs are full of them. Encode hyphens to underscores on the way in and back on the way out — `src/server/lib/ltree.ts` owns this and nothing else should hand-roll it.

**Grid re-render explosion.** The default failure mode is selection state in React context, which re-renders every cell on every arrow key. Selection lives in Zustand, cells subscribe to a slice, and cells are memo'd on `(value, isSelected, isEditing)`. Verify with the Profiler in Step 7a before building anything on top.

**Clipboard TSV is not one format.** Excel, Google Sheets, and Numbers each quote, escape, and terminate lines differently, and macOS vs Windows line endings differ again. Write the parser defensively and test against the real applications.

**Optimistic updates and change sets can drift.** The grid writes locally first. If the change set fails, the local state must roll back to the *server's* value, not the pre-edit local value.

**`STALE_PREVIEW` is a feature.** A preview held open while someone else edits must fail on commit rather than clobber. Surface it as "3 items changed since you previewed — refresh?" and never auto-retry.

**Variant propagation is eventually consistent above the threshold.** The UI must show the propagating state.

**Override is key-presence, not a flag.** `variant.values[key]` existing *is* the override; deleting the key reverts.

**`item_field_index` is derived, always.** It must be rebuildable from `effective_values` alone. The nightly `projectionAudit` job samples 1% and alerts on drift.

**Validation must not block the save.** A bad value goes to `invalid_values` and the rest of the item commits.

**CSV injection on export is real.** A cell starting with `=` becomes a formula in Excel. Prefix with `'`.

**Never log item content.** Sentry `beforeSend` strips request bodies and any `values`/`effective_values` payload. PostHog gets event names and IDs only. Session replay masks all grid cell text.

**Fail open on rate limiting.** If Redis is unreachable, allow the request.

**Reparenting can create cycles.** Check before writing: the new parent's path must not be a descendant of the moving subtree. Reject with `HIERARCHY_CYCLE`.

**Adding a required field to an in-use Item Type** must either supply a default or force an explicit "leave existing items incomplete" acknowledgment.

**Index migrations on `items` must be `CONCURRENTLY`** and outside a transaction.

---

## Out of Scope for This Build

Do not implement these unless explicitly asked:

- Native iOS/Android apps
- Timeline / Gantt view, calendar view
- Automations builder (trigger → condition → action)
- Dashboards / reporting / charts
- Slack, GitHub, Google Calendar, or any other native integration — API and webhooks only
- Any AI feature
- Stripe billing and plan gating (structure `workspaces.plan` for it; do not wire it up)
- Field-level permissions as a security boundary (Phase 2 — v1 contains the gap by denying Guests API access)
- View-scoped / channel-scoped completeness
- More than one user-created category tree
- Variants nested inside the work hierarchy
- Comments / threaded discussion
- Time tracking, sprints, docs, wiki, chat
- SSO/SAML, 2FA
- SOC 2 / HIPAA compliance work
- Real-time multiplayer cursors or live co-editing (React Query refetch-on-focus is sufficient for v1)

If a step seems to require one of these, stop and flag it rather than building it.
