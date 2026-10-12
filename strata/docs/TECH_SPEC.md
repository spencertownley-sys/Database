# Strata — Technical Specification

**Version:** 1.0
**Date:** August 15, 2026
**Companion to:** `strata-PRD.md`

---

## 1. Architecture Overview

### 1.1 System Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser (React 19 SPA shell inside Next.js App Router)              │
│  ─ TanStack Table + TanStack Virtual  → grid rendering               │
│  ─ TanStack Query                     → server cache, optimistic UI  │
│  ─ Zustand                            → grid selection/edit state    │
└────────────────────────────┬─────────────────────────────────────────┘
                             │  HTTPS  /api/v1/*   (same surface as public API)
┌────────────────────────────▼─────────────────────────────────────────┐
│  Next.js 15 (Vercel) — Route Handlers                                │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Middleware: auth → workspace resolution → rate limit → RLS ctx │  │
│  ├────────────────────────────────────────────────────────────────┤  │
│  │ Service layer:  items · itemTypes · trees · variants ·          │  │
│  │                 changeSets · views · imports · permissions      │  │
│  ├────────────────────────────────────────────────────────────────┤  │
│  │ Data access:    Drizzle ORM + hand-written SQL for recursive    │  │
│  │                 CTEs and the filter compiler                    │  │
│  └────────────────────────────────────────────────────────────────┘  │
└──┬──────────────┬──────────────────┬─────────────────┬───────────────┘
   │              │                  │                 │
┌──▼──────────┐ ┌─▼──────────────┐ ┌─▼─────────────┐ ┌─▼──────────────┐
│ PostgreSQL  │ │ Upstash Redis  │ │ Inngest       │ │ Supabase       │
│ 16          │ │ ─ rate limits  │ │ ─ bulk >500   │ │ Storage        │
│ (Supabase)  │ │ ─ view cache   │ │ ─ imports     │ │ ─ uploads      │
│ ─ RLS on    │ │ ─ idempotency  │ │ ─ exports     │ │ ─ export files │
│   every     │ │   keys         │ │ ─ variant     │ └────────────────┘
│   tenant    │ └────────────────┘ │   propagation │
│   table     │                    │ ─ webhooks    │ ┌────────────────┐
└─────────────┘                    │ ─ completeness│ │ Resend         │
                                   └───────────────┘ │ ─ email        │
┌──────────────────────┐                             └────────────────┘
│ Supabase Auth        │
│ ─ email/password     │  Observability: Sentry (errors) · PostHog
│ ─ magic link         │  (product analytics + session replay) ·
│ ─ Google OAuth       │  Vercel/Axiom (logs, traces)
└──────────────────────┘
```

**One API surface.** The web app calls `/api/v1/*` — the same versioned REST endpoints published to customers. There is no private second API. This costs some convenience (no bespoke aggregate endpoints shaped for one screen) and buys a public API that is dogfooded by every feature, so it cannot rot.

> ⚠️ **Assumption:** Traffic at launch is modest (< 50 workspaces, < 500 DAU). The architecture is deliberately boring and single-region. Multi-region, read replicas, and CQRS are explicitly deferred.

### 1.2 Tech Stack Decision Table

| Layer | Choice | Rationale |
|---|---|---|
| Frontend framework | **Next.js 15 (App Router), React 19, TypeScript strict** | Server Components for the shell and detail views; Client Components for the grid. One deployable, one type system end to end. |
| Grid | **TanStack Table v8 + TanStack Virtual v3** | Headless — full control over cell rendering and keyboard/selection behavior, which a batteries-included data grid would fight. Virtualization is the part not worth writing. Selection, clipboard, and fill are custom (see §6.3). |
| Server cache / data fetching | **TanStack Query v5** | Optimistic updates, request dedup, and cache invalidation keyed by view+filter — necessary for grid responsiveness. |
| Local UI state | **Zustand** | Grid selection rectangle, edit buffer, and undo stack live outside React Query's cache. Small and fast; Redux is overkill. |
| Styling | **Tailwind CSS v4 + shadcn/ui** | shadcn is copy-in, not a dependency — it can be modified for the dense, data-forward grid chrome without fighting a library's opinions. |
| Backend / API | **Next.js Route Handlers** (`/api/v1`) | Colocated with the frontend, one deploy, one CI. If API traffic later demands independent scaling, handlers extract to a standalone Node service without changing the contract. |
| Validation | **Zod** | One schema definition shared between route handlers, the dynamic field validator, and the client. Dynamic user-defined fields compile to Zod schemas at runtime (§7.1). |
| Database | **PostgreSQL 16 (Supabase)** | JSONB, GIN indexes, recursive CTEs, `ltree`, and row-level security are all first-party. Every hard requirement in this product maps onto a native Postgres feature. |
| ORM / query layer | **Drizzle ORM** | Typed schema and migrations, with a genuine raw-SQL escape hatch. The filter compiler and recursive CTEs are hand-written SQL; an ORM that hides SQL would be a liability here. |
| Auth | **Supabase Auth** | Email/password + magic link + Google. Issues a JWT carrying `workspace_id` and `role`, which RLS policies read directly — the tenant isolation story is enforced in one place. |
| Background jobs | **Inngest** | Durable, serverless-native, step-level retries with built-in observability. Bulk ops, imports, exports, variant propagation, and webhook delivery are all long-running and must survive a redeploy. |
| Cache / rate limit | **Upstash Redis** | Serverless-friendly. Sliding-window rate limiting, idempotency keys, cached view result-ID sets. |
| File storage | **Supabase Storage** | Import uploads and generated export files. Signed URLs, workspace-prefixed paths. |
| Email | **Resend + React Email** | Transactional only in v1: invites, assignment, import done, export ready. Templates as React components, reviewable in PRs. |
| Hosting | **Vercel** (app) · **Supabase** (db/auth/storage) · **Upstash** · **Inngest** | Four managed services, no infrastructure to operate. Roughly $100–200/mo at launch scale. |
| CI/CD | **GitHub Actions** → Vercel | Typecheck, lint, unit, integration (against ephemeral Postgres), E2E on preview deploy. Migrations gated (§9.4). |
| Monitoring | **Sentry** · **PostHog** · **Vercel/Axiom logs** | Sentry for exceptions + performance traces. PostHog for the PRD funnel metrics and session replay on the grid — replay is how grid usability bugs actually get found. |
| Testing | **Vitest** · **Testcontainers** · **Playwright** | See §8. |

### 1.3 Key Architectural Decisions

#### AD-1: Custom field storage — hybrid JSONB + typed projection index

**Chosen:** canonical values in a JSONB column on `items`, plus a narrow `item_field_index` table holding typed, indexed copies of only those fields marked filterable or sortable.

**Rejected:**

- *Pure EAV* (`item_field_values` row per field per item). Correct and flexible, and the way Akeneo does it. But rendering a 40-column grid page means 40 joins or a wide pivot per request. The grid is the product; this loses on the critical path.
- *Pure JSONB with dynamic expression indexes.* `CREATE INDEX ON items ((values->>'due_date'))` per filterable field works beautifully for one tenant and becomes an operational hazard across thousands — DDL on user action, index bloat, lock risk during migrations, and no bound on index count.
- *Dynamic per-tenant tables* (a real column per user field). Fastest possible reads. Unbounded DDL, per-tenant schema drift, and migration nightmares. Non-starter for a multi-tenant SaaS.

**Why the hybrid:** grid reads fetch one row per item — no joins, no pivots — because the whole value bag is in one JSONB column. Filters and sorts hit `item_field_index`, which is narrow (one row per item per *indexed* field, not per field), typed into discrete columns so Postgres can use real btree indexes, and covered by a small fixed set of indexes that exist at migration time rather than at user whim.

**Cost, stated honestly:** writes touch two places, so the write path must be transactional and the projection must never drift. Marking a previously-unindexed field as filterable requires a backfill job over existing items. Both are handled explicitly in §2.4 and §6.2.

#### AD-2: Every write goes through a Change Set

**Chosen:** all item mutations — single-cell edit, bulk update, import commit, API `PATCH`, undo itself — are recorded as a `change_set` with per-item, per-field before/after `change_entries`.

**Rejected:** a separate append-only audit log written alongside mutations. Two code paths, and audit gaps are only discovered when someone needs the audit.

**Why:** the PRD requires preview-before-commit, undo-after-commit, and full change history. All three are the same mechanism. A change set in `preview` status *is* the preview; committing applies it; undo generates its inverse; the committed set *is* the history. One concept, three requirements, no drift between what happened and what was logged.

**Cost:** a single-cell edit writes a change set plus one entry, so write volume is ~3× naive. Acceptable — the app is read-heavy, and single-cell change sets are pruned to a compacted form after 90 days (§6.5).

#### AD-3: Three hierarchy axes, three distinct mechanisms

| Axis | Mechanism | Query shape |
|---|---|---|
| Work hierarchy | `items.parent_id` adjacency list + materialized `items.path` (`ltree`) | Subtree by `path <@ 'root.a.b'`, single index hit. No recursive CTE on the read path. |
| Category trees | `item_tree_nodes` join table (many-to-many) + `tree_nodes.path` (`ltree`) | Node + descendants resolved by path prefix, then a single join. |
| Variants | `items.variant_parent_id` + field-level `inheritance` on the Item Type | Effective values materialized on write (§2.5), never resolved at read time. |

**Rejected:** one unified `relationships` table with a `kind` discriminator. Elegant on paper; every query then filters on `kind` and loses the ability to index each axis for its actual access pattern. The three axes have genuinely different shapes — one is a tree, one is a many-to-many DAG-ish membership, one is a two-level inheritance chain.

**Why `ltree` over recursive CTEs on read:** subtree filtering must hit the p95 budget in §6.1 at depth 8. A recursive CTE walks; an `ltree` GiST index seeks. The cost is maintaining `path` on reparent, which is a bounded write-time subtree update (§2.3).

#### AD-4: Materialize effective values for variants

**Chosen:** `items.effective_values` (JSONB) is computed on write as `model.values` overlaid with `variant.values` for variant-level and overridden fields. Reads — grid, filter, completeness, export — use `effective_values` exclusively.

**Rejected:** resolving inheritance at read time via a join to the model. Correct, and it makes propagation free. It also puts a join and a merge on the single hottest path in the product, and makes filtering on an inherited field require the filter compiler to understand inheritance.

**Why:** reads outnumber writes by orders of magnitude, and the filter compiler stays simple — it only ever sees one flat value bag per item. Editing a shared field on a model enqueues a propagation job over its variants.

**Cost:** eventual consistency between a model edit and its variants' materialized values. Bounded and made honest: propagation for ≤ 50 variants runs inline in the same transaction; above that it's a job, the model shows a "propagating to N variants" indicator, and `POST /items/:id/recompute` is exposed to admins as a repair path.

#### AD-5: Tenant isolation in the database, not only the application

**Chosen:** every tenant-scoped table carries `workspace_id`; Postgres RLS policies gate every row on a session-local `app.workspace_id`; the data-access layer sets it via `SET LOCAL` inside every transaction.

**Rejected:** application-layer scoping alone (a repository that always adds `WHERE workspace_id = ?`). It works right up until one hand-written query forgets, and that one query is a cross-tenant data leak.

**Why:** the PRD calls workspace isolation non-negotiable. Application scoping is the primary mechanism because it produces better query plans; RLS is the backstop that makes a forgotten `WHERE` clause return zero rows instead of another customer's data.

**Cost:** connection pooling must not leak session state across requests — enforced by wrapping every request in a transaction and using `SET LOCAL` (transaction-scoped), never `SET`. This is the single highest-consequence invariant in the codebase and is tested directly (§8).

#### AD-6: Postgres-native search in v1, with a designed escape hatch

**Chosen:** filtering via a SQL compiler over `item_field_index`; text search via `pg_trgm` GIN on a maintained `items.search_text`.

**Why not Typesense/Meilisearch/Elastic on day one:** an external index is a second source of truth, a sync pipeline, an eventual-consistency window users will notice on their own writes, and another service to operate — for a scale target Postgres handles.

**The escape hatch, designed now:** all filter/search requests go through a single `SearchProvider` interface with one implementation (`PostgresSearchProvider`). When p95 breaches budget at scale, a second implementation lands behind the same interface without touching call sites. This is written down so it does not become a rewrite.

---

## 2. Data Model

Conventions: all PKs are `uuid` (v7, time-ordered for index locality). All tenant tables carry `workspace_id uuid NOT NULL` with an RLS policy. All tables have `created_at`, `updated_at timestamptz NOT NULL DEFAULT now()`.

### 2.1 Identity & Tenancy

```
Table: workspaces
- id: uuid, PK
- name: text NOT NULL
- slug: text NOT NULL UNIQUE            -- URL segment
- plan: text NOT NULL DEFAULT 'free'    -- free | pro | business
- settings: jsonb NOT NULL DEFAULT '{}' -- feature flags, defaults
- created_at, updated_at: timestamptz

Table: users                             -- mirrors Supabase auth.users
- id: uuid, PK                           -- == auth.users.id
- email: citext NOT NULL UNIQUE
- name: text
- avatar_url: text
- created_at, updated_at

Table: workspace_members
- id: uuid, PK
- workspace_id: uuid NOT NULL → workspaces(id) ON DELETE CASCADE
- user_id: uuid NOT NULL → users(id) ON DELETE CASCADE
- role: text NOT NULL                    -- owner | admin | member | guest | viewer
- invited_by: uuid → users(id)
- accepted_at: timestamptz               -- null = pending invite
- created_at, updated_at
UNIQUE (workspace_id, user_id)
INDEX (user_id)                          -- "my workspaces"

Table: guest_scopes                       -- which tree nodes a guest may see
- id: uuid, PK
- workspace_id: uuid NOT NULL
- member_id: uuid NOT NULL → workspace_members(id) ON DELETE CASCADE
- tree_node_id: uuid NOT NULL → tree_nodes(id) ON DELETE CASCADE
- include_descendants: boolean NOT NULL DEFAULT true
UNIQUE (member_id, tree_node_id)
```

### 2.2 Schema Definition (Item Types & Fields)

```
Table: item_types
- id: uuid, PK
- workspace_id: uuid NOT NULL
- key: text NOT NULL                     -- immutable slug, used in API
- label: text NOT NULL                   -- mutable display name
- description: text
- icon: text                             -- lucide icon name
- color: text                            -- hex
- variant_axes: jsonb NOT NULL DEFAULT '[]'
    -- ordered: [{ "field_key": "region", "label": "Region" }]
    -- empty = variants disabled for this type
- preset_source: text                    -- which starter preset it came from (analytics)
- archived_at: timestamptz
- created_at, updated_at
UNIQUE (workspace_id, key)

Table: field_groups
- id: uuid, PK
- workspace_id: uuid NOT NULL
- item_type_id: uuid NOT NULL → item_types(id) ON DELETE CASCADE
- key: text NOT NULL
- label: text NOT NULL
- position: integer NOT NULL
- collapsed_by_default: boolean NOT NULL DEFAULT false
UNIQUE (item_type_id, key)

Table: fields
- id: uuid, PK
- workspace_id: uuid NOT NULL
- item_type_id: uuid NOT NULL → item_types(id) ON DELETE CASCADE
- field_group_id: uuid → field_groups(id) ON DELETE SET NULL
- key: text NOT NULL                     -- IMMUTABLE. JSONB key + API key.
- label: text NOT NULL                   -- mutable
- type: text NOT NULL
    -- text | long_text | number | currency | percent | date | datetime
    -- | select | multi_select | checkbox | url | email | user | relation
- config: jsonb NOT NULL DEFAULT '{}'
    -- select/multi_select: { options: [{id,label,color}] }
    -- number/currency/percent: { precision, min, max, currency_code }
    -- relation:              { target_item_type_id, cardinality }
    -- user:                  { multiple: bool }
- position: integer NOT NULL
- required_for_completeness: boolean NOT NULL DEFAULT false
- inheritance: text NOT NULL DEFAULT 'variant'
    -- 'shared'  = owned by variant model, inherited read-only by variants
    -- 'variant' = owned independently per variant
    -- ignored when the item type has no variant_axes
- is_indexed: boolean NOT NULL DEFAULT false   -- projected into item_field_index
- is_searchable: boolean NOT NULL DEFAULT false -- concatenated into items.search_text
- deleted_at: timestamptz                -- soft delete, 30-day restore window
- created_at, updated_at
UNIQUE (item_type_id, key)
INDEX (item_type_id, position) WHERE deleted_at IS NULL
```

**Notes.** `key` is immutable and `label` is not — this is what makes §4.1's "renaming never breaks data" true. `is_indexed` defaults to `false` and is set automatically the first time a user filters or sorts on the field (triggering a backfill job), plus always-on for the `select`, `multi_select`, `date`, `datetime`, `user`, and `checkbox` types, which are overwhelmingly the ones people filter by.

### 2.3 Items

```
Table: items
- id: uuid, PK
- workspace_id: uuid NOT NULL
- item_type_id: uuid NOT NULL → item_types(id) ON DELETE RESTRICT
- title: text NOT NULL                   -- promoted out of JSONB; always present, always sortable
- parent_id: uuid → items(id) ON DELETE RESTRICT   -- work hierarchy
- path: ltree NOT NULL                   -- materialized: 'root_uuid.child_uuid...' (hyphens → underscores)
- depth: integer NOT NULL                -- == nlevel(path) - 1, denormalized for filters
- position: numeric NOT NULL             -- fractional index for drag-order among siblings
- variant_parent_id: uuid → items(id) ON DELETE CASCADE
- is_variant_model: boolean NOT NULL DEFAULT false
- values: jsonb NOT NULL DEFAULT '{}'    -- canonical own values, keyed by field.key
- effective_values: jsonb NOT NULL DEFAULT '{}'  -- values merged with inherited (AD-4)
- invalid_values: jsonb NOT NULL DEFAULT '{}'    -- flagged drafts that failed coercion (PRD §6.4)
- completeness_pct: smallint NOT NULL DEFAULT 0  -- 0..100
- missing_required: text[] NOT NULL DEFAULT '{}' -- field keys, for the detail panel
- search_text: text                      -- maintained concat of searchable fields + title
- archived_at: timestamptz
- created_by, updated_by: uuid → users(id)
- created_at, updated_at

INDEX items_ws_type_idx      ON items (workspace_id, item_type_id) WHERE archived_at IS NULL
INDEX items_path_gist        ON items USING GIST (path)
INDEX items_parent_idx       ON items (parent_id, position)
INDEX items_variant_idx      ON items (variant_parent_id) WHERE variant_parent_id IS NOT NULL
INDEX items_search_trgm      ON items USING GIN (search_text gin_trgm_ops)
INDEX items_values_gin       ON items USING GIN (effective_values jsonb_path_ops)
INDEX items_completeness_idx ON items (workspace_id, completeness_pct)
INDEX items_keyset_idx       ON items (workspace_id, item_type_id, created_at DESC, id DESC)

CHECK (NOT (is_variant_model AND variant_parent_id IS NOT NULL))
CHECK (NOT (is_variant_model AND parent_id IS NOT NULL))          -- v1 constraint, PRD §4.6
```

Relationships: `belongs_to item_type`, `belongs_to parent (items)`, `has_many children (items)`, `belongs_to variant_parent (items)`, `has_many variants (items)`, `has_many item_tree_nodes`.

**Reparenting.** Changing `parent_id` requires rewriting `path` and `depth` for the item and its entire subtree:

```sql
UPDATE items
SET path  = :new_parent_path || subpath(path, nlevel(:old_path) - 1),
    depth = nlevel(:new_parent_path || subpath(path, nlevel(:old_path) - 1)) - 1
WHERE workspace_id = :ws AND path <@ :old_path;
```

Bounded by subtree size, done in one statement, inside the change-set transaction. A cycle check runs first (`:new_parent_path` must not be a descendant of `:old_path`) and rejects with `HIERARCHY_CYCLE`.

### 2.4 Field Value Projection Index

```
Table: item_field_index
- item_id: uuid NOT NULL → items(id) ON DELETE CASCADE
- workspace_id: uuid NOT NULL
- field_id: uuid NOT NULL → fields(id) ON DELETE CASCADE
- value_text: text
- value_number: numeric
- value_date: timestamptz
- value_bool: boolean
- value_uuid: uuid                       -- user / relation / select-option refs
- value_text_array: text[]               -- multi_select option ids
PRIMARY KEY (item_id, field_id)

INDEX ifi_text_idx   ON item_field_index (workspace_id, field_id, value_text)   WHERE value_text   IS NOT NULL
INDEX ifi_number_idx ON item_field_index (workspace_id, field_id, value_number) WHERE value_number IS NOT NULL
INDEX ifi_date_idx   ON item_field_index (workspace_id, field_id, value_date)   WHERE value_date   IS NOT NULL
INDEX ifi_uuid_idx   ON item_field_index (workspace_id, field_id, value_uuid)   WHERE value_uuid   IS NOT NULL
INDEX ifi_array_gin  ON item_field_index USING GIN (value_text_array)           WHERE value_text_array IS NOT NULL
```

Only fields with `is_indexed = true` are projected. Rows are written in the same transaction as the item write. **This table is a derived artifact** — it must be rebuildable from `items.effective_values` alone, and a nightly consistency job samples 1% of items to verify (alerting on any drift). Marking a field indexed enqueues a chunked backfill (5,000 items per step) that reports progress in the UI.

### 2.5 Variant Resolution

Not a table — the write-path algorithm, stated once so every doc agrees:

```
computeEffectiveValues(item):
  if item.variant_parent_id is null:
      return item.values
  model  = load(item.variant_parent_id)
  fields = fieldsOf(item.item_type_id)
  out = {}
  for f in fields:
      if f.inheritance == 'shared':
          out[f.key] = model.values[f.key]                    # always the model's
      else:
          out[f.key] = item.values[f.key] ?? model.values[f.key]  # override, else inherit
  # variant axis values always come from the variant itself
  for axis in itemType.variant_axes:
      out[axis.field_key] = item.values[axis.field_key]
  return out
```

- **Model write:** recompute the model, then recompute all variants. ≤ 50 variants → same transaction. > 50 → Inngest job, model flagged `propagating` until done.
- **Variant write:** recompute that variant only.
- **Override semantics:** the presence of a key in `variant.values` *is* the override. Reverting to inherited deletes the key. There is no separate "is_overridden" flag to fall out of sync.
- **Completeness** is computed from `effective_values`, so an inherited value counts as filled.

### 2.6 Category Trees

```
Table: trees
- id: uuid, PK
- workspace_id: uuid NOT NULL
- key: text NOT NULL
- label: text NOT NULL
- is_builtin: boolean NOT NULL DEFAULT false
- position: integer NOT NULL
UNIQUE (workspace_id, key)

Table: tree_nodes
- id: uuid, PK
- workspace_id: uuid NOT NULL
- tree_id: uuid NOT NULL → trees(id) ON DELETE CASCADE
- parent_id: uuid → tree_nodes(id) ON DELETE RESTRICT
- path: ltree NOT NULL
- label: text NOT NULL
- position: numeric NOT NULL
- item_count: integer NOT NULL DEFAULT 0   -- denormalized, direct members only
INDEX tree_nodes_path_gist ON tree_nodes USING GIST (path)
INDEX (tree_id, parent_id, position)

Table: item_tree_nodes                     -- many-to-many
- item_id: uuid NOT NULL → items(id) ON DELETE CASCADE
- tree_node_id: uuid NOT NULL → tree_nodes(id) ON DELETE CASCADE
- workspace_id: uuid NOT NULL
- added_at: timestamptz NOT NULL DEFAULT now()
PRIMARY KEY (item_id, tree_node_id)
INDEX itn_node_idx ON item_tree_nodes (tree_node_id, item_id)
```

Subtree membership query (node + descendants), one GiST seek plus one join:

```sql
SELECT i.* FROM items i
JOIN item_tree_nodes itn ON itn.item_id = i.id
JOIN tree_nodes tn       ON tn.id = itn.tree_node_id
WHERE i.workspace_id = :ws AND tn.path <@ :node_path;
```

`item_count` is denormalized for tree-sidebar rendering and updated in the same transaction as membership changes; it is direct-members-only, with descendant rollups computed in one grouped query when the sidebar loads.

### 2.7 Change Sets (preview · commit · undo · audit)

```
Table: change_sets
- id: uuid, PK
- workspace_id: uuid NOT NULL
- actor_id: uuid → users(id)              -- null for system/automation
- source: text NOT NULL                   -- ui_cell | ui_bulk | import | api | undo | system
- operation: text NOT NULL                -- set_field | clear_field | change_type | reparent
                                          -- | tree_assign | tree_unassign | delete | create
                                          -- | assign_user | variant_propagate
- status: text NOT NULL                   -- preview | committing | committed | failed | undone
- summary: jsonb NOT NULL                 -- { item_count, skipped_count, fields:[...], per_field_delta }
- item_count: integer NOT NULL DEFAULT 0
- skipped: jsonb NOT NULL DEFAULT '[]'    -- [{ item_id, reason }] reason: permission|validation|locked
- parent_change_set_id: uuid → change_sets(id)  -- set on an undo, pointing at what it reversed
- undone_by_id: uuid → change_sets(id)
- idempotency_key: text
- expires_at: timestamptz                 -- previews GC'd after 1h
- committed_at: timestamptz
- created_at, updated_at
UNIQUE (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL
INDEX cs_ws_created_idx ON change_sets (workspace_id, created_at DESC)

Table: change_entries
- id: bigserial, PK                        -- high volume; bigserial not uuid
- change_set_id: uuid NOT NULL → change_sets(id) ON DELETE CASCADE
- workspace_id: uuid NOT NULL
- item_id: uuid NOT NULL
- field_key: text                          -- null for whole-item ops (create/delete/reparent)
- before: jsonb                            -- null on create
- after: jsonb                             -- null on delete
INDEX ce_set_idx  ON change_entries (change_set_id)
INDEX ce_item_idx ON change_entries (workspace_id, item_id, id DESC)   -- per-item history
```

**Lifecycle.**

1. `POST /change-sets` with `{operation, target, patch}` → server resolves affected items, computes `before`/`after` per entry, evaluates permission and validation skips, writes `status='preview'`, returns the summary plus up to 20 sample rows. Nothing in `items` has changed.
2. `POST /change-sets/:id/commit` → single transaction: apply entries, update `effective_values`, `item_field_index`, `completeness_pct`, `search_text`, `path` as applicable; `status='committed'`. Optimistic concurrency: each entry's `before` is compared against the current value and a mismatch fails the whole commit with `STALE_PREVIEW`, so a preview that sat open while someone else edited cannot silently clobber.
3. `POST /change-sets/:id/undo` → creates a *new* change set with `source='undo'`, entries inverted, `parent_change_set_id` set; commits it; marks the original `undone`. Undo is itself in the history and is itself undoable.
4. Preview rows expire after 1h. Committed sets are retained per §6.5.

Single-cell edits take the same path with `item_count=1` and skip the preview step (auto-commit), which is what makes `Ctrl+Z` work identically for one cell and for 300 rows.

### 2.8 Views, Imports, API Access

```
Table: views
- id: uuid, PK
- workspace_id: uuid NOT NULL
- item_type_id: uuid → item_types(id) ON DELETE CASCADE   -- null = cross-type
- name: text NOT NULL
- type: text NOT NULL                     -- grid | list | board
- owner_id: uuid → users(id)
- visibility: text NOT NULL               -- private | workspace | shared
- share_token: text UNIQUE                -- set when visibility='shared'
- config: jsonb NOT NULL
    -- { filters: <FilterGroup>, sort: [{field_key, dir}], visible_fields: [key],
    --   group_by: field_key|null, column_widths: {}, column_order: [], row_height: 'short' }
- position: integer
INDEX (workspace_id, item_type_id)

Table: import_profiles
- id: uuid, PK
- workspace_id: uuid NOT NULL
- item_type_id: uuid NOT NULL
- name: text NOT NULL
- mapping: jsonb NOT NULL     -- { columns: [{source, field_key, transform}], match_key: field_key|null }
- created_by: uuid → users(id)

Table: import_jobs
- id: uuid, PK
- workspace_id: uuid NOT NULL
- import_profile_id: uuid → import_profiles(id)
- item_type_id: uuid NOT NULL
- file_path: text NOT NULL                -- Supabase Storage key
- status: text NOT NULL     -- uploaded | mapping | validating | ready | committing | committed | failed
- row_count, valid_count, error_count: integer
- error_file_path: text                   -- generated error CSV
- change_set_id: uuid → change_sets(id)   -- set on commit; makes imports undoable
- created_by: uuid → users(id)

Table: api_keys
- id: uuid, PK
- workspace_id: uuid NOT NULL
- name: text NOT NULL
- key_hash: text NOT NULL                 -- SHA-256; plaintext shown once at creation
- key_prefix: text NOT NULL               -- 'sk_live_a1b2', displayed in the UI
- scopes: text[] NOT NULL                 -- ['items:read','items:write','schema:read',...]
- last_used_at: timestamptz
- expires_at, revoked_at: timestamptz
INDEX (key_hash)

Table: webhooks
- id: uuid, PK
- workspace_id: uuid NOT NULL
- url: text NOT NULL
- events: text[] NOT NULL                 -- ['item.created','item.updated',...]
- secret: text NOT NULL                   -- HMAC-SHA256 signing key
- is_active: boolean NOT NULL DEFAULT true
- failure_count: integer NOT NULL DEFAULT 0   -- auto-disabled at 20 consecutive

Table: webhook_deliveries
- id: bigserial, PK
- webhook_id: uuid NOT NULL → webhooks(id) ON DELETE CASCADE
- event: text NOT NULL
- payload: jsonb NOT NULL
- status_code: integer
- attempt: integer NOT NULL DEFAULT 1
- delivered_at, next_retry_at: timestamptz
INDEX (webhook_id, id DESC)

Table: notifications
- id: uuid, PK
- workspace_id: uuid NOT NULL
- user_id: uuid NOT NULL
- type: text NOT NULL                     -- assigned | invited | export_ready | import_done
                                          -- ('mentioned' arrives with comments in Phase 2)
- payload: jsonb NOT NULL
- read_at: timestamptz
INDEX (user_id, read_at, id DESC)
```

### 2.9 Entity Relationship Summary

```
workspaces ──< workspace_members >── users
     │              └──< guest_scopes >── tree_nodes
     ├──< item_types ──< field_groups ──< fields
     │         └──────────< items
     ├──< items ──self── parent_id        (work hierarchy, ltree path)
     │      ├──self── variant_parent_id   (variant axis)
     │      ├──< item_field_index >── fields
     │      └──< item_tree_nodes >── tree_nodes >── trees
     ├──< change_sets ──< change_entries ──> items
     ├──< views
     ├──< import_profiles ──< import_jobs ──> change_sets
     ├──< api_keys
     └──< webhooks ──< webhook_deliveries
```

---

## 3. Authentication & Authorization

- **Provider:** Supabase Auth. Email/password, magic link, Google OAuth.
- **Session:** httpOnly, secure, sameSite=lax cookie holding a Supabase JWT. Access token 1h, refresh rotating.
- **Workspace context:** the active workspace comes from the URL (`/w/:slug/...`), validated against `workspace_members` on every request. It is never taken from a client-supplied header or body field.
- **API keys:** `Authorization: Bearer sk_live_...`, SHA-256 compared against `api_keys.key_hash`, scoped and workspace-bound. Machine tokens only — an API key cannot act as a Guest, which is how the PRD §9 Risk 3 gap is contained in v1.

### 3.1 Role Matrix

| Capability | Owner | Admin | Member | Guest | Viewer |
|---|:--:|:--:|:--:|:--:|:--:|
| Billing, plan, delete workspace | ✓ | — | — | — | — |
| Invite/remove members, set roles | ✓ | ✓ | — | — | — |
| Create/edit/delete Item Types & fields | ✓ | ✓ | — | — | — |
| Create/edit trees & nodes | ✓ | ✓ | — | — | — |
| Manage API keys & webhooks | ✓ | ✓ | — | — | — |
| Create items | ✓ | ✓ | ✓ | — | — |
| Edit items | ✓ | ✓ | ✓ | scoped* | — |
| Delete items | ✓ | ✓ | ✓ | — | — |
| Bulk operations & import | ✓ | ✓ | ✓ | — | — |
| Undo own change sets | ✓ | ✓ | ✓ | — | — |
| Undo others' change sets | ✓ | ✓ | — | — | — |
| Create private/workspace views | ✓ | ✓ | ✓ | — | — |
| Share a view externally | ✓ | ✓ | ✓ | — | — |
| Read items | all | all | all | scoped* | all |
| Export | ✓ | ✓ | ✓ | — | ✓ |

\* **Guest scope** = items belonging to any `tree_node` in that guest's `guest_scopes` (descendants included when flagged), further restricted to the field subset of the view they were invited through. Guests edit only granted fields on in-scope items — they cannot create or delete items, run bulk operations, or use the API.

### 3.2 Enforcement Layers

1. **Route middleware** — authenticates, resolves workspace membership, rejects unauthenticated/non-member requests before any handler runs.
2. **Service layer** — a single `can(actor, action, resource)` function. Every mutating service call passes through it. This is the layer that produces the specific denial messages the PRD requires.
3. **Postgres RLS** — the backstop. Every tenant table has:

```sql
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
CREATE POLICY items_tenant_isolation ON items
  USING      (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
```

Every request runs inside a transaction that begins with `SET LOCAL app.workspace_id = :ws`. **`SET LOCAL`, never `SET`** — transaction-scoped, so a pooled connection cannot carry one tenant's context into another tenant's request. This invariant has a dedicated test (§8).

RLS handles tenancy only. Guest node-scoping is enforced at the service layer, because expressing it in RLS would require a correlated subquery on every row read and would not pay for itself.

---

## 4. Environment Variables

| Variable | Description | Required |
|---|---|:--:|
| `DATABASE_URL` | Postgres pooled connection (PgBouncer, transaction mode) | ✅ |
| `DIRECT_DATABASE_URL` | Direct connection — migrations only | ✅ |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Never exposed to the client. | ✅ |
| `SUPABASE_STORAGE_BUCKET` | Bucket for imports/exports (default `strata-files`) | ✅ |
| `UPSTASH_REDIS_REST_URL` | Redis REST endpoint | ✅ |
| `UPSTASH_REDIS_REST_TOKEN` | Redis token | ✅ |
| `INNGEST_EVENT_KEY` | Job event key | ✅ |
| `INNGEST_SIGNING_KEY` | Verifies inbound job invocations | ✅ |
| `RESEND_API_KEY` | Transactional email | ✅ |
| `EMAIL_FROM` | e.g. `Strata <no-reply@strata.app>` | ✅ |
| `APP_URL` | Canonical base URL, used in emails and webhooks | ✅ |
| `API_KEY_PEPPER` | Server-side pepper for API key hashing | ✅ |
| `WEBHOOK_SIGNING_VERSION` | Signature scheme version (`v1`) | ✅ |
| `SENTRY_DSN` | Error tracking | ➖ |
| `NEXT_PUBLIC_POSTHOG_KEY` | Product analytics | ➖ |
| `STRIPE_SECRET_KEY` | Phase 2 billing | ➖ |
| `STRIPE_WEBHOOK_SECRET` | Phase 2 billing | ➖ |
| `MAX_IMPORT_ROWS` | Default `50000` | ➖ |
| `BULK_SYNC_THRESHOLD` | Items above which bulk goes async. Default `500` | ➖ |
| `VARIANT_SYNC_THRESHOLD` | Variants above which propagation goes async. Default `50` | ➖ |

---

## 5. Third-Party Integrations

| Service | Purpose | SDK / version | Limits & cost | Fallback if unavailable |
|---|---|---|---|---|
| **Supabase** | Postgres, Auth, Storage | `@supabase/supabase-js` v2, `@supabase/ssr` | Pro $25/mo, 8GB db, 100GB storage | Total outage. Status banner, read-only messaging, no silent retry loops. |
| **Upstash Redis** | Rate limiting, idempotency, view cache | `@upstash/redis`, `@upstash/ratelimit` | Pay-per-request; ~$10/mo at launch | **Fail open** on rate limiting (availability over enforcement at this scale), **fail through** on cache (go to Postgres). Never fail closed. |
| **Inngest** | Bulk >500, imports, exports, propagation, webhooks | `inngest` v3 | Free to 50k steps/mo | Jobs queue and retry with backoff. UI shows "queued." Synchronous paths (bulk ≤500, variants ≤50) are unaffected — this is why those thresholds exist. |
| **Resend** | Transactional email (invite, assignment, import done, export ready) | `resend` v4, `@react-email/components` | 3k/mo free, then $20/mo | Queue and retry ×3 over 1h. Email is never on a critical path — in-app notifications are the source of truth. |
| **Sentry** | Errors + traces | `@sentry/nextjs` | Free tier at launch | Degrade silently. Never let the error reporter break the request. |
| **PostHog** | Analytics + session replay | `posthog-js`, `posthog-node` | 1M events/mo free | Client-side; drop events on failure. |
| **Stripe** *(Phase 2)* | Billing | `stripe` v17 | 2.9% + 30¢ | Not in v1. Schema (`workspaces.plan`) is structured for it now. |

---

## 6. Performance & Scalability

### 6.1 Budgets

These are **acceptance criteria**, restated from PRD §6.5. A build that misses them has not met the requirement.

| Operation | p95 target | Scale point |
|---|---|---|
| Filtered + sorted page, 100 rows | **< 300 ms** server | 100k items, 40 fields, 8 filter clauses |
| Keystroke → rendered filtered result | **< 500 ms** end-to-end | as above, 300ms debounce included |
| Text search | **< 400 ms** | 100k items |
| Subtree filter (node + descendants) | **< 300 ms** | tree depth 8, 50k items in subtree |
| Item detail load (all fields + activity) | **< 200 ms** | |
| Single cell write → confirmed | **< 150 ms** | optimistic UI renders instantly |
| Bulk commit, 500 items | **< 3 s** | synchronous path |
| Bulk commit, 10k items | **< 60 s** | async, with progress |
| Import validate, 10k rows | **< 30 s** | async |
| Grid scroll | **60 fps** | 10k rows loaded client-side |
| Initial app shell TTI | **< 2 s** | cold, simulated Fast 3G |

Expected launch load: < 50 workspaces, < 500 DAU, largest workspace ~100k items, peak ~50 req/s. The budgets are set an order of magnitude above launch need so that the first large customer is not an incident.

### 6.2 Filter Compiler

The filter tree from `views.config.filters` compiles to parameterized SQL. Shape:

```ts
type FilterGroup = { op: 'and' | 'or'; children: (FilterGroup | FilterClause)[] }
type FilterClause = {
  field: string          // field key, or a built-in: 'title'|'completeness'|'tree'|'depth'|'parent'
  operator: 'eq'|'neq'|'gt'|'gte'|'lt'|'lte'|'contains'|'starts_with'
          | 'in'|'not_in'|'is_empty'|'is_not_empty'|'between'|'in_subtree'
  value: unknown
}
```

Rules, non-negotiable:

- Every clause on a user field resolves to an `EXISTS` subquery against `item_field_index` on `(workspace_id, field_id, value_*)`. Never a JSONB scan on the hot path.
- Field keys are resolved to `field_id` **via the schema**, never interpolated as identifiers. Values are always bound parameters. No string concatenation of user input reaches SQL — the compiler has no code path that can produce one.
- A clause on a non-indexed field returns `FIELD_NOT_FILTERABLE` with an action to index it (which enqueues the backfill), rather than silently falling back to a slow scan.
- `in_subtree` compiles to `path <@ :ltree_path` against `items` or `tree_nodes`.
- Max 20 clauses and max nesting depth 4 per view. Beyond that, reject with a clear message.
- Every compiled query is `EXPLAIN`-checked in CI against a seeded 100k-item fixture; a plan containing a sequential scan on `items` fails the build.

### 6.3 Grid Performance

- **Pagination:** keyset (`WHERE (sort_value, id) < (:last_value, :last_id)`), never `OFFSET`. Page size 100; the grid prefetches ±2 pages around the viewport.
- **Virtualization:** TanStack Virtual renders only visible rows plus a 10-row overscan. Cell components are `memo`'d on `(value, isSelected, isEditing)` — the single most common cause of grid jank is re-rendering every cell on selection change.
- **Selection state lives in Zustand, not React state**, and cells subscribe to a selection *slice*, so moving the selection re-renders two cells rather than ten thousand.
- **Optimistic writes:** the cell commits locally, the mutation fires, and a failure rolls the cell back with an inline error. The user never waits on the network to keep typing.
- **Write coalescing:** rapid edits to the same cell debounce at 400ms into one change set. Edits across different cells batch into one request every 250ms.
- **Payload discipline:** the list endpoint returns only `visible_fields`, not the whole `effective_values` bag. A 40-field type showing 8 columns sends 8 values.

### 6.4 Caching

| Layer | What | TTL | Invalidation |
|---|---|---|---|
| React Query | View results, item details | 30s stale | On mutation, by `[workspace, itemType, viewHash]` key |
| Redis | Compiled-filter → item ID sets for shared views | 60s | Any change set touching the item type busts the type's key namespace |
| Redis | Item Type + field definitions | 5 min | On schema mutation |
| Postgres | `items.effective_values`, `completeness_pct`, `item_field_index`, `search_text` | — | Recomputed transactionally on write |
| CDN | Static assets | 1 year, hashed | Build hash |

No caching of item *content* beyond React Query's 30s window — stale content in a collaborative editing surface is worse than a fast round trip.

### 6.5 Growth Path & Data Retention

Named in advance so nobody discovers them under load:

1. **`change_entries` volume.** Highest-growth table by far. Sets with `item_count = 1` compact after 90 days into a single summary entry per item per day; full history retained for bulk sets for 1 year, then archived to Storage as JSONL.
2. **`item_field_index` write amplification.** An item with 20 indexed fields writes 20 rows per update. Mitigated by writing only *changed* fields, not the whole projection.
3. **Filter latency at 1M+ items.** Triggers the `SearchProvider` swap (AD-6) to Typesense. The interface exists from day one.
4. **Postgres connection ceiling.** PgBouncer transaction pooling from the start; serverless function count is the real limiter, not the database.
5. **Variant fan-out.** A model with 500 variants makes every shared-field edit a 500-row write. Hard cap at 200 variants per model in v1, with a clear error, revisited with real usage.

---

## 7. Security

### 7.1 Input Validation

- Every route handler validates its body, query, and params with Zod before the handler body runs. No handler reads an unvalidated field.
- **Dynamic field values** are validated by a Zod schema compiled from the Item Type's field definitions and cached in Redis for 5 minutes. Per PRD §6.4, a value that fails coercion is written to `items.invalid_values` with an error message rather than rejecting the whole item write.
- Uploads: extension + MIME + magic-byte check, 50 MB cap, parsed in a job (never in a request handler), stored under `{workspace_id}/{uuid}` so a path is never user-controlled.

### 7.2 Injection & XSS

- **SQL:** Drizzle parameterizes. Hand-written SQL uses `sql` tagged templates with bound parameters exclusively. The filter compiler's identifier resolution goes through the schema (field key → `field_id` UUID), so no user string ever becomes an identifier. A lint rule bans raw string concatenation inside `sql` templates.
- **XSS:** React escapes by default. `dangerouslySetInnerHTML` is banned by ESLint with no exceptions in v1 (long-text fields render as plain text with linkification, not HTML). CSP: `default-src 'self'`, no `unsafe-eval`, strict-dynamic nonces for scripts.
- **CSV injection on export:** any cell value beginning with `=`, `+`, `-`, `@`, tab, or CR is prefixed with `'`. This is a real, commonly-missed vulnerability in exactly this class of product.

### 7.3 Rate Limiting

Sliding window via Upstash, keyed by user for session traffic and by API key for programmatic traffic:

| Scope | Limit |
|---|---|
| Auth endpoints (login, signup, reset) | 10 / 15 min per IP + per email |
| Session API, read | 300 / min per user |
| Session API, write | 120 / min per user |
| API key, read | 600 / min |
| API key, write | 120 / min |
| Bulk change-set creation | 20 / min per user |
| Import upload | 10 / hour per workspace |
| Export | 20 / hour per workspace |
| Webhook delivery (outbound) | 10 / s per endpoint |

Returns 429 with `Retry-After` and `X-RateLimit-*` headers. **Fails open** if Redis is unreachable — a rate limiter that takes down the product when its cache blips is a worse outcome than brief unmetered traffic at this scale.

### 7.4 Sensitive Data

- Passwords: handled entirely by Supabase Auth (bcrypt). The application never sees a plaintext password.
- API keys: SHA-256 + `API_KEY_PEPPER`. Plaintext returned exactly once at creation. `key_prefix` only in the UI thereafter.
- Webhook secrets: encrypted at rest via Supabase Vault; shown once.
- PII: workspace members' names, emails, and avatars. Item content is customer data — never logged, never sent to third parties. **Sentry `beforeSend` strips request bodies and any `values`/`effective_values` payload**; PostHog captures event names and IDs, never field content. Session replay masks all grid cell text by default.
- Deletion: workspace deletion cascades and purges Storage objects within 30 days. Export-my-data endpoint ships in v1 (cheap now, painful to retrofit).

### 7.5 Transport & CORS

- HTTPS enforced; HSTS `max-age=31536000; includeSubDomains; preload`.
- Session cookies: `httpOnly`, `secure`, `sameSite=lax`.
- CORS: session endpoints allow the app origin only, credentials true. API-key endpoints allow `*` with credentials false — a browser cannot be tricked into using ambient cookies against them.
- Additional headers: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` except on the shared-view route, which allows framing from configured origins only.

### 7.6 Known Gaps in v1

Stated plainly rather than discovered later:

- **Field-level permissions are not a security boundary.** A view's `visible_fields` is presentation. Guests have no API access precisely because that is what keeps the gap closed. Real field-level ACLs are Phase 2 (PRD §9 Risk 3).
- **No SSO/SAML.** Google OAuth only.
- **No audit export.** History is queryable in-app; a compliance-grade export is not in v1.
- **No 2FA.** Deferred to Phase 2 with SSO.

---

## 8. Testing Strategy

| Layer | Approach | Tools |
|---|---|---|
| **Unit** | Pure logic: variant resolution, completeness, filter compiler AST → SQL, type coercion, ltree path math, change-set inversion | Vitest |
| **Property-based** | Variant inheritance (any model/variant/override combination resolves consistently); change-set invert-then-apply is identity; `path` stays consistent under arbitrary reparent sequences | Vitest + fast-check |
| **Integration** | Service layer against real Postgres: RLS enforcement, transactional integrity of item + projection + completeness writes, concurrent-edit `STALE_PREVIEW` handling | Vitest + Testcontainers (Postgres 16) |
| **Contract** | Every `/api/v1` endpoint validated against the OpenAPI spec both directions; spec drift fails the build | Vitest + `zod-to-openapi` |
| **Performance** | Seeded 100k-item × 40-field workspace; assert §6.1 budgets; `EXPLAIN` assertions rejecting seq scans on `items` | Vitest + `pg_stat_statements`, run nightly and on any query-layer PR |
| **E2E** | Critical paths: signup → Item Type in < 2 min; grid paste from clipboard TSV; bulk edit preview → commit → undo; import round trip; variant create + propagate; guest sees only scoped items | Playwright |
| **Accessibility** | Automated axe pass on every major screen; manual keyboard-only walkthrough of grid and Item Type builder each release | `@axe-core/playwright` |
| **Manual QA** | Grid feel — selection, fill, paste from real Excel and real Google Sheets on macOS and Windows. **Cannot be automated meaningfully and must not be skipped.** | Checklist per release |

**Three tests that must exist before anything else ships:**

1. **Tenant isolation.** Two workspaces, identical data. Every list and read endpoint, called with workspace A's context, returns zero rows from B — including a deliberately mis-written query with no application-level `WHERE workspace_id`, proving RLS catches it.
2. **Undo fidelity.** For each of the 9 change-set operations: snapshot → apply → undo → assert deep equality with the snapshot, including `effective_values`, `item_field_index`, `completeness_pct`, and `path`.
3. **Projection consistency.** After any mutation path, `item_field_index` matches what a from-scratch rebuild off `effective_values` would produce.

Coverage target: 80% on the service layer, 95% on variant resolution / completeness / filter compiler. Coverage on UI components is not a goal — E2E and manual grid QA cover what matters there.

---

## 9. Deployment

### 9.1 Environments

| Env | URL | Database | Purpose |
|---|---|---|---|
| Local | `localhost:3000` | Docker Postgres 16 + seed | Development |
| Preview | `*.vercel.app` per PR | Shared preview branch (Supabase branching) | Review + E2E |
| Staging | `staging.strata.app` | Isolated, anonymized production-shaped seed | Migration rehearsal, load tests |
| Production | `app.strata.app` | Supabase Pro, PITR enabled | |

### 9.2 Pipeline

Push → GitHub Actions: typecheck → lint → unit + property → integration (Testcontainers) → build → Vercel preview → Playwright E2E against preview → migration dry-run against a staging clone. Merge to `main` → migrate staging → E2E on staging → manual approval gate → migrate production → deploy → smoke suite → Sentry release marker.

### 9.3 Rollback

- **App:** Vercel instant rollback to the previous deployment. < 1 min.
- **Database:** forward-only. Every migration ships in two phases (§9.4) so the previous app version always runs against the new schema. Rollback is an app rollback; the schema stays.
- **Data:** Supabase PITR, 7-day window. Restoring is an incident-level action requiring two-person approval, not a routine tool.
- **Feature flags:** every risky feature (variants, async bulk, import commit) is behind a workspace-level flag in `workspaces.settings`, so a bad feature is disabled without a deploy.

### 9.4 Migrations

Drizzle Kit, checked into the repo, sequentially numbered, never edited after merge.

**Expand/contract, mandatory:**

1. *Expand* — add the nullable column / new table / new index. Deploy. Old and new app versions both run.
2. *Backfill* — chunked Inngest job, 5,000 rows per step, idempotent and resumable.
3. *Contract* — add the constraint, drop the old column. Separate deploy, at least one release later.

Rules: indexes on `items`, `item_field_index`, and `change_entries` are created `CONCURRENTLY` and outside a transaction. No migration takes an `ACCESS EXCLUSIVE` lock on `items` during business hours. Every migration is rehearsed against a production-sized staging clone and its duration recorded in the PR before it is allowed to merge.

---

## 10. Traceability

| PRD requirement | Where it lands technically |
|---|---|
| §4.1 Item Type in < 2 min | `item_types` presets + Advanced-gated config; measured in E2E |
| §4.2 Grid interaction | §6.3; TanStack Table/Virtual; Zustand selection |
| §4.3 Preview + undo | AD-2; `change_sets` lifecycle §2.7 |
| §4.4 Import profiles | `import_profiles` / `import_jobs`, committing via a change set |
| §4.5 Multi-tree classification | `trees` / `tree_nodes` / `item_tree_nodes`, ltree §2.6 |
| §4.6 Variants | AD-4; `variant_parent_id` + `fields.inheritance` §2.5 |
| §4.7 Completeness | `completeness_pct` / `missing_required`, recomputed on write |
| §4.8 Views | `views.config`; filter compiler §6.2 |
| §4.9 Permissions + isolation | §3; AD-5 RLS + service-layer `can()` |
| §6.4 Non-blocking validation | `items.invalid_values` §7.1 |
| §6.5 Performance budgets | §6.1, enforced in CI §8 |
| §9 Risk 3 (view ≠ security) | §7.6, contained by denying Guests API access |
