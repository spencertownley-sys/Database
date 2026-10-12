# Strata — Complete Product Specification

**Version:** 1.0 · **Date:** 2026-10-12
**Status:** Consolidated reference. Steps 1–7 built, Steps 8–16 outstanding.

> **Relationship to the other documents.** `PRD.md`, `TECH_SPEC.md`, `API_DESIGN.md`,
> `UI_UX_NOTES.md`, and `LAUNCH_CHECKLIST.md` are the authoritative source documents and
> each owns its domain. This document consolidates all five into one narrative —
> purpose, every feature, every function, the full UI, and the data — and adds a
> column none of them have: **what is actually built today**.
>
> Where this document and a source document disagree, the source document wins.
> Known divergences between the *code* and the source documents are tracked
> separately in `SPEC_RECONCILIATION.md`.

---

## Part 1 — Purpose

### 1.1 What Strata is, in one paragraph

Strata is a web-based work-management platform that looks like Monday.com or ClickUp —
boards, lists, saved views, a familiar sidebar — but runs on a structured data model
borrowed from PIM (Product Information Management) tooling. Teams define reusable
**Item Types** with their own typed fields, organise work across three independent axes,
see a **completeness score** on every record, and edit hundreds of items at a time in a
**spreadsheet-grade grid** where every bulk change is previewed before it commits and
undoable after.

### 1.2 The problem

Most work-management tools assume work is a flat list of tasks with a few custom fields.
Real work at most teams past a certain size is a structured hierarchy with repeating shape:

| Team | The shape of their work |
|---|---|
| **Agency** | 40 clients × 6 recurring deliverable types × 12 months ≈ 2,900 items a year, each with client-specific fields (brand guidelines link, approval contact, SLA tier) that differ by deliverable type. |
| **Product marketing** | One campaign existing in 14 regional variants. Thirteen fields identical across regions; three differ (local launch date, localised asset link, regional budget). |
| **Ops** | Equipment, contracts, and locations in one system. A Contract has renewal date, counterparty, value. A Location has square footage, lease expiry, site manager. Nothing is shared except that both are work. |

Today those teams have three bad options:

| Option | What breaks |
|---|---|
| **Monday / ClickUp** | Custom fields are per-board and loosely typed. No reusable schema, no inheritance, no bulk-editing story past a few dozen rows. Teams duplicate boards, copy-paste rows by hand, and find out six months later that half the records are missing data nobody noticed. |
| **Jira** | Real hierarchy exists but is fixed-depth, developer-shaped, and administered through a settings UI a marketing lead will not touch. Custom field config is a Jira-admin task. |
| **Akeneo (PIM)** | Exactly the right data model — families, attribute groups, category trees, product models with variant inheritance, completeness scoring. Also, by broad consensus among its own users, painful to set up, requiring technical staff, and built for product catalogues rather than work. |

**The gap: nobody has taken the PIM data model and made it usable by a non-technical team,
inside a work-management tool.**

The cost is mundane and measurable. Teams spend hours a week on manual duplication, cannot
answer *"which of our 300 deliverables are missing a required field,"* and hit a ceiling
where the tool that got them to 20 people actively obstructs them at 60.

### 1.3 The bet

The data model is not the hard part — making it approachable is. So the product's centre of
gravity is the **grid view**: a spreadsheet-grade editing surface with inline cells,
rectangular selection, copy/paste to and from Excel, fill-down, and undo, over hundreds of
structured items. Everything a team would otherwise do by hand across dozens of cards, they
do in one grid in one pass, with a preview of what is about to change and one-click undo after.

### 1.4 Goals

**Primary.** A non-technical team member can define a structured Item Type with custom
fields and start working with hundreds of items of that type — bulk-editing, importing,
filtering, reparenting — without a schema editor, an admin ticket, or any code.

**Secondary.**
1. **Make hierarchy legible.** A user can see and navigate three independent axes without confusing them.
2. **Make gaps visible.** Every item and view surfaces how complete it is, so missing data is caught in the tool rather than in a client meeting.
3. **Make bulk operations safe.** Every multi-item change is previewed before it commits and reversible after, so people stop being afraid of the bulk tools.
4. **Make performance a feature.** Filter and search stay under half a second at 100k items per workspace.

### 1.5 Positioning

| Claim | Monday | ClickUp | Jira | Akeneo | **Strata** |
|---|:--:|:--:|:--:|:--:|:--:|
| Reusable typed schema across boards | ✗ | Partial | Admin-only | ✓ | ✓ non-technical |
| Multi-parent classification trees | ✗ | ✗ | ✗ | ✓ | ✓ |
| Field inheritance / variants | ✗ | ✗ | ✗ | ✓ | ✓ |
| Completeness scoring | ✗ | ✗ | ✗ | ✓ | ✓ |
| Spreadsheet-grade bulk editing | ✗ | ✗ | ✗ | Partial | ✓ |
| Set up by a non-technical user | ✓ | ✓ | ✗ | ✗ | ✓ |

The defensible position is the **last row combined with the middle four**. Any single row is
copyable; Monday could add completeness scoring in a quarter. What is hard to copy is a data
model designed for inheritance and multi-tree classification from the schema up, wrapped in
an interface a marketing ops lead sets up herself in an afternoon — because retrofitting that
model onto a flat-board product is a rewrite, and adding approachability to Akeneo is a
decade of accumulated admin surface.

**What this is not:** "Jira with different colours" or "Monday with custom fields." If a demo
can be summarised either way, the demo led with the wrong thing. Lead with the grid, on 300
rows, doing a bulk edit with preview and undo.

---

## Part 2 — Users

### 2.1 Primary — "The Ops-Minded Operator"

| | |
|---|---|
| **Who** | Agency operations lead, marketing ops manager, or business ops generalist at a 20–150 person company. Owns the tooling, is not an engineer. |
| **Pain** | She built the current Monday board and is now the only one who understands it. She spends 3–5 hours a week duplicating recurring work, hand-fixing rows, and chasing people for missing fields. She has been told Jira "would fix this" and looked at it once. |
| **Goal** | Set up a structure once that holds up as the team grows, and stop being the human integration layer. |
| **Context** | Desktop, 2–4 hours a day in the tool, often with a spreadsheet open beside it. Lives in bulk operations and saved views. |
| **Tech savvy** | High for a non-engineer. Fluent in Excel (pivot tables, VLOOKUP). Comfortable with the idea of a "field type." Will not write SQL or edit YAML. |

She is both buyer and admin. If Item Type creation takes more than a few minutes or feels
like a database tool, the product is dead at first contact — precisely where Akeneo loses
non-technical teams.

### 2.2 Secondary — "The Contributor"

Designer, writer, account manager, or coordinator doing the actual work. 5–20 per workspace.
Does not care about the data model. Wants to see what is assigned, update status, and close
the tool. Board or list view, 15–30 minutes a day, occasionally on a tablet.

**The design constraint they impose:** a Contributor should be able to use Strata for months
without ever learning what a variant is. Every advanced concept must be invisible by default.

### 2.3 Tertiary — "The Client / External Stakeholder"

Guest-role user invited to a scoped slice of a category tree. Read-mostly, sees a curated
field subset, updates the handful of fields they have been granted. Matters because agency
workflows are the sharpest wedge, and *"can I show this to my client without showing them our
internal margin field"* is a purchase-blocking question.

---

## Part 3 — Core concepts (the vocabulary)

These names appear identically in the product, the API, and every document.

| Concept | Definition | Akeneo analogue |
|---|---|---|
| **Workspace** | The tenant. Hard data-isolation boundary. Has members, roles, billing. | — |
| **Item** | The atomic unit. A task, deliverable, campaign, contract, piece of equipment. | Product |
| **Item Type** | Reusable template defining which fields an item has, which are required, how they are grouped. | Family |
| **Field** | A typed attribute definition. 14 types in v1. Belongs to an Item Type. | Attribute |
| **Field Group** | Named section fields belong to, so the detail view is not one 40-field wall. | Attribute group |
| **Work hierarchy** | Parent/child nesting of items. Arbitrary depth. The "project → deliverable → subtask" axis. | — |
| **Category Tree** | A named, nested classification. Items belong to zero or more nodes, across multiple trees at once. Independent of the work hierarchy. | Category tree |
| **Variant Model** | An item acting as a template for its variants. Owns the shared field values. | Product model |
| **Variant** | A child of a Variant Model that inherits shared fields and overrides only fields on its variant axis. | Product variant |
| **Variant Axis** | The field(s) defining what varies — Region, Channel. Declared on the Item Type. | Variation axis |
| **Completeness** | % of an item's required fields that are filled. Shown on the item, aggregated in views. | Completeness |
| **View** | A saved configuration: view type, filters, sort, visible field subset, grouping. Shareable. | Channel/locale (loosely) |
| **Change Set** | An atomic, previewable, undoable batch of item mutations. Also the audit record. | — |
| **Import Profile** | A saved CSV/Excel column-to-field mapping, reusable across imports. | Import job profile |

### 3.1 The three axes

The concept most likely to confuse a Monday/ClickUp switcher. An item participates in all
three simultaneously and independently.

```
Work hierarchy  — "what is part of what"    Q3 Launch → Landing Page → Copy review
Category trees  — "how do we classify it"   Q3 Launch is in [Client: Acme] and [Product: Widgets]
Variants        — "what version of it"      Q3 Launch → Q3 Launch (EMEA), Q3 Launch (APAC)
```

Each is a genuinely different shape and gets its own mechanism: an ltree-backed tree, a
many-to-many membership, and a two-level inheritance chain.

---

## Part 4 — Feature inventory

### 4.1 Item Type Builder

> *Define a reusable Item Type with my own fields in under two minutes.*

- Creation from a starter preset — **Task · Client Project · Campaign · Product Variant · Structured Record · Blank** — takes ≤ 2 minutes from "New Item Type" click to first item created. **This is a gating metric, not an aspiration.**
- The preset step comes first: six cards, each showing its field names on the face.
- Default creation screen shows name, icon/colour, and a field list. Nothing else.
- Field creation is one row: name + type picker. Type-specific config (select options, number precision, relation target) expands inline only after a type is chosen.
- Field groups, variant axes, completeness requirements, and per-field permissions live behind an **Advanced** disclosure, collapsed by default, remembering state per user.
- Renaming a field never breaks stored data — fields have an immutable `key` and a mutable `label`.
- Changing a field's type requires a conversion preview showing clean / coerced / preserved-as-text counts. Nothing is silently destroyed.
- Deleting a field soft-deletes for 30 days with a restore path; values retained.
- Adding a required field to an in-use Item Type requires either a default value or an explicit "leave existing items incomplete" acknowledgement.

### 4.2 The 14 field types

| Type | Stores | Cell treatment | Index column |
|---|---|---|---|
| `text` | string | Left, truncate, tooltip | text |
| `long_text` | string | Single line + popover editor | text |
| `number` | number | **Right, tabular numerals** | number |
| `currency` | number | Right, formatted per currency code | number |
| `percent` | number (45 = 45%) | Right, `%` suffix | number |
| `date` | `YYYY-MM-DD` | Relative within ±7 days, absolute otherwise | date |
| `datetime` | ISO 8601 UTC | As above | date |
| `select` | option id | Coloured pill | text |
| `multi_select` | option id array | 2 pills + "+N" overflow | text_array |
| `checkbox` | boolean | Centred checkbox | bool |
| `url` | absolute URL | Link-styled, small click target | text |
| `email` | lowercase address | Link-styled | text |
| `user` | user uuid | Avatar + name | uuid / text_array |
| `relation` | item uuid | Item title as chip | uuid / text_array |

**Coercion is generous; validation is honest.** A user pasting from Excel sends `1,250`,
`£1,250.00`, `45%`, `TRUE`, `3/14/2026`, `(1,250)`, `1.234,56`, Excel serial dates, and
`Name <a@b.com>`. All of those are accepted. What coercion never does is guess wrongly and
silently — anything genuinely ambiguous fails with an actionable message.

**Validation never blocks the save.** A value failing coercion is written to
`items.invalid_values` with a message while every other field on the item commits. Rejecting
a whole row because one cell says "TBD" loses real user work and reads as data loss.

### 4.3 Grid view — the hero surface

- Inline cell editing: click to select, type to replace, Enter commits and moves down, Tab commits and moves right, Esc cancels.
- Full keyboard navigation — the complete map is normative and in §6.1.
- Multi-cell rectangular selection with visible border and a count readout ("42 cells, 12 rows").
- Copy writes TSV to `text/plain` and a table to `text/html`, pasteable directly into Excel and Google Sheets.
- Paste maps clipboard TSV onto the selection rectangle, coerces per column type, and previews non-convertible values before committing. A single copied cell tiles across a larger selection.
- Fill-down (`Ctrl/⌘+D`) and fill-handle drag, with increment detection for numbers, dates, and trailing-integer text (`Q1 2026` → `Q2 2026`).
- Undo and redo across ≥ 50 operations, including bulk operations.
- Column reorder by drag, resize, pin/freeze leading columns, show/hide via field picker.
- Row grouping by any field, collapsible, with per-group aggregates (count, sum, avg, % complete).
- Virtualised rendering: 10,000 loaded rows at 60fps.
- A completeness column available in every grid — compact bar + %.
- Validation errors render inline with a specific message and never block saving the rest of the row.

### 4.4 Bulk operations and undo

> *See exactly what a bulk edit will change before it commits, so I trust the tool on 300 rows.*

- Every operation affecting more than one item routes through a **Change Set** with a preview step.
- The preview shows: items affected, per-field before → after, up to 20 sample rows, and a count of items that will be skipped **with reasons** (permission, validation, locked).
- Commit is explicit. The preview is never auto-applied on a timer or on modal dismiss.
- The commit button **names the count** — "Apply to 142 items," never "Confirm."
- After commit, a persistent toast offers **Undo** for 60 seconds with a draining progress line; the change set remains undoable from the activity feed for 24 hours.
- Undo restores prior values for every field touched and is itself recorded as a change set — undo is auditable, not a hole in history, and is itself undoable (redo).
- Skipped items are always reported. A partial undo must never present as a complete one.
- Above 500 items, the operation runs as a background job with progress and the UI stays usable.

**The nine operations:** `create` · `set_field` · `clear_field` · `change_type` · `reparent` ·
`tree_assign` · `tree_unassign` · `delete` · `assign_user`.
A tenth, `variant_propagate`, is system-only and never user-initiated.

### 4.5 Category trees

- One built-in tree plus at least one user-created tree in v1.
- Arbitrary nesting depth; nodes drag-reorderable and drag-reparentable.
- An item can belong to multiple nodes within one tree and to nodes in multiple trees at once.
- Selecting a node filters to its items, with an include-descendants toggle.
- Assignment by drag from grid/list onto the tree, and as a bulk operation.
- Deleting a node always asks what to do with its items — **unassign / move to parent / move to chosen node**. Items are never silently orphaned.
- Tree membership shows on the item detail panel as removable chips.

### 4.6 Variants

- An Item Type can declare one or more **variant axes**, each backed by a `select` field.
- Each field is marked **shared** (owned by the model, inherited read-only by variants) or **variant-level** (owned independently per variant).
- Creating a model and generating variants across an axis is one guided action: pick axis values → preview the N variants → create.
- A variant displays inherited values with a distinct visual treatment and an "inherited from [model]" affordance.
- Overriding an inherited value is explicit, and the override is marked with one-click "revert to inherited."
- Editing a shared field on the model propagates to all non-overridden variants; the preview states how many variants will be affected.
- Completeness is computed per variant from its effective (inherited + overridden) values.
- **v1 constraint:** an item cannot be both a Variant Model and a work-hierarchy parent, and variants have no work-hierarchy children. Hard cap of 200 variants per model.

### 4.7 Completeness

- Fields are individually markable as required-for-completeness.
- Completeness = filled required fields ÷ total required fields, shown as a % and a bar.
- Recomputed on every write; filterable and sortable like any field.
- The detail panel lists exactly which required fields are missing, each a click-to-focus link.
- Views show an aggregate for the filtered set, and per group when grouped.
- A saved view can filter "incomplete only" as a one-click preset.
- Informational, never blocking. No red badges in the sidebar, no "you have 47 incomplete items" interruptions. The user goes looking for it.

### 4.8 Views

- Three view types over the same data: **grid**, **list**, **board**. Switching preserves filters and sort.
- Views save with a name, owner, and visibility (private / workspace / shared-with-guests).
- A view stores type, filters, sort, visible field subset, group-by, and per-column width/order.
- Board groups by any `select` or `user` field; dragging between columns writes the field via a change set.
- Filters compose with AND/OR groups across any field, including completeness, tree membership, and hierarchy depth.
- The item detail panel opens over any view and is deep-linkable.
- A view shared with a Guest exposes only its visible field subset. **This is a presentation control, not a security boundary** — see §9.3.

### 4.9 Import and export

- Upload CSV or XLSX, ≤ 50MB. Header row auto-detected, first 20 rows previewed.
- Column mapping suggests target fields by fuzzy name match with a confidence indicator (green = high, amber = guess, grey = unmapped). Unmapped columns are explicit, never silent.
- Mappings save as named **Import Profiles**, re-selectable next time.
- A dry-run validation report runs before any write: row count, new vs. matched-existing via a chosen match key, per-column coercion warnings, downloadable error CSV.
- Import commits as a single Change Set and is undoable like anything else.
- Export respects the current view — filters, sort, visible fields, grouping — as CSV or XLSX.
- Exports over 5,000 rows run as a background job with a notification and signed link.
- **CSV injection guard:** any value beginning `=`, `+`, `-`, `@`, tab, or CR is prefixed with `'`.

### 4.10 Permissions and admin

Five roles. Workspace isolation is enforced at the database layer, not only in application code.

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

\* **Guest scope** = items in any tree node in that guest's `guest_scopes` (descendants
included when flagged), further restricted to the field subset of the view they were invited
through. Guests cannot create or delete items, run bulk operations, or use the API.

Every permission-denied action produces a specific message, never a silent no-op or a blank screen.

### 4.11 Activity and notifications

- Per-item activity feed showing every change set that touched it — who, when, before → after.
- Workspace activity feed, filterable by user, item type, and date.
- Email for assignment, guest invitation, import completed, export ready. Batched digest option.
- In-app notification centre with unread state.

---

## Part 5 — Functions (what the system does internally)

### 5.1 Data model — 22 tables

**Tenancy.** `workspaces` · `users` · `workspace_members` · `guest_scopes`
**Schema.** `item_types` · `field_groups` · `fields`
**Data.** `items` · `item_field_index`
**Trees.** `trees` · `tree_nodes` · `item_tree_nodes`
**Writes.** `change_sets` · `change_entries`
**Config.** `views` · `import_profiles` · `import_jobs` · `export_jobs`
**Integration.** `api_keys` · `webhooks` · `webhook_deliveries` · `notifications`

The `items` table carries all three axes at once:

```
id · workspace_id · item_type_id · title
parent_id · path (ltree) · order_key          ← work hierarchy
is_variant_model · variant_of_id · variant_axis_values   ← variants
values · effective_values · invalid_values    ← field data
completeness_pct · missing_required · search_text   ← derived
assignee_id · created_by · updated_by · deleted_at
```

Category-tree membership lives in the `item_tree_nodes` join table, since it is many-to-many.

### 5.2 Hybrid field storage

Canonical values live in a JSONB column on `items`; a narrow `item_field_index` table holds
typed, indexed copies of only the fields marked filterable or sortable.

**Why.** Grid reads fetch one row per item — no joins, no pivots — because the whole value bag
is in one JSONB column. Filters and sorts hit `item_field_index`, which is narrow (one row per
item per *indexed* field), typed into discrete columns so Postgres can use real B-tree
indexes, and covered by a fixed set of indexes that exist at migration time rather than at
user whim.

**What was rejected.** Pure EAV (40 joins to render a 40-column grid). Pure JSONB with dynamic
expression indexes (DDL on user action, index bloat, no bound on index count). Dynamic
per-tenant tables (unbounded DDL, per-tenant schema drift).

**The cost, stated honestly.** Writes touch two places, so the write path must be transactional
and the projection must never drift. `item_field_index` is a **derived artifact** — it must be
rebuildable from `effective_values` alone, and a nightly job samples 1% to verify.

### 5.3 Change sets — the universal write path

Every item mutation — single-cell edit, bulk update, import commit, API `PATCH`, undo itself
— is recorded as a change set with per-item, per-field before/after entries.

```
preview    → nothing written to items. Holds computed before/after per item,
             a summary, and up to 20 sample rows. Expires after 1 hour.
commit     → one transaction. Applies entries; updates values, effective_values,
             item_field_index, completeness_pct, missing_required, search_text, path.
undo       → builds the inverse set, source='undo', parent_change_set_id set,
             commits it, marks the original undone.
```

**Optimistic concurrency.** Each entry's stored `before` is compared against the item's current
value at commit; any mismatch fails the **whole** commit with `STALE_PREVIEW`. A preview held
open while someone else edits cannot silently clobber. Never auto-retried.

Single-cell edits take the same path with `item_count = 1` and auto-commit — which is what
makes `Ctrl+Z` behave identically for one cell and for 300 rows.

### 5.4 Variant resolution

Effective values are **materialised on write**, not resolved on read. Reads outnumber writes by
orders of magnitude, and the filter compiler stays simple because it only ever sees one flat
value bag per item.

```
computeEffectiveValues(item):
  if not a variant: return item.values
  for each field:
    shared   → model.values[key]                        (always the model's)
    variant  → item.values[key] ?? model.values[key]    (override, else inherit)
  axis fields → always the variant's own value
```

Override is **key presence**, not a flag: `variant.values[key]` existing *is* the override, and
deleting the key reverts. A separate `is_overridden` boolean would be a second source of truth
that drifts.

Model write → recompute model, then variants. ≤ 50 variants inline; above that an async job
with a visible "propagating to N variants" indicator.

### 5.5 Tenant isolation

Three layers, each a backstop for the one above:

1. **Route middleware** — authenticates, resolves workspace membership, rejects non-members before any handler runs.
2. **Service layer** — a single `can(actor, action, resource)` across 49 actions, producing the specific denial messages the product requires.
3. **Postgres RLS** — every tenant table gates every row on `current_setting('app.workspace_id')`.

Every request runs inside a transaction beginning with `SET LOCAL app.workspace_id`.
**`SET LOCAL`, never `SET`** — session-scoped state survives on pooled connections and hands
one tenant's context to another tenant's request. This is the single highest-consequence
invariant in the codebase.

**The app connects as a non-owner role.** Table owners bypass RLS by default and superusers
bypass it unconditionally, so an app connecting as the owner has policies that are purely
decorative — and every isolation test would pass against a database with no policies at all.

### 5.6 Filter compiler

A `FilterGroup` AST compiles to parameterised SQL. 26 operators across six storage classes.

Rules, non-negotiable:
- Every clause on a user field becomes an `EXISTS` subquery against `item_field_index`. Never a JSONB scan on the hot path.
- Field keys resolve to `field_id` **through the schema**, never interpolated as identifiers. Values are always bound parameters. **No code path exists that can produce string-concatenated SQL.**
- Max 20 clauses, max nesting depth 4.
- A clause on a non-indexed field returns `FIELD_NOT_FILTERABLE` with an action to index it, rather than silently running a slow scan.
- Every compiled query is `EXPLAIN`-checked in CI; a plan containing a sequential scan on `items` fails the build.

### 5.7 Pagination and search

Keyset pagination only — `WHERE (sort_value, id) < (:last_value, :last_id)`, never `OFFSET`.
At 100k items an `OFFSET 50000` scan re-reads fifty thousand rows to discard them, and a row
inserted mid-paging causes a silent duplicate or skip.

Text search is `pg_trgm` GIN over a maintained `items.search_text` concatenating title and
searchable fields. An external search index is deliberately deferred behind a `SearchProvider`
interface so the swap is a new class, not a rewrite.

### 5.8 Background jobs

`bulkCommit` · `importValidate` · `importCommit` · `exportGenerate` · `variantPropagate` ·
`fieldBackfill` · `webhookDeliver` · `projectionAudit` (nightly 1% consistency sample).

Every job must be idempotent and resumable.

### 5.9 API surface

`/api/v1` is the same API the web app uses. There is no private second API — which costs some
convenience and buys a public API that cannot rot because every feature dogfoods it.

| Group | Endpoints |
|---|---|
| Auth | `signup` `login` `logout` `me` |
| Item Types | list · create · get · patch · delete · fields · field-groups · type-change-preview |
| Items | list · get · create · patch · delete · recompute · generate-variants |
| Change Sets | create (preview) · commit · undo · list · entries |
| Trees | trees · nodes · node items (bulk assign/unassign) |
| Views | CRUD · view items |
| Transfer | imports · import mapping · import commit · import profiles · exports |
| Admin | workspaces · data-export · members · invite · notifications · api-keys · webhooks |

Conventions: cursor pagination, `Idempotency-Key` honoured on all POSTs for 24h,
RFC 3339 UTC times, UUID v7 ids, OpenAPI 3.1 generated from the Zod schemas with contract
tests failing the build on drift.

Two endpoints are unauthenticated and only two: `GET /api/health` and `GET /share/:token`.

### 5.10 Security posture

| Area | Measure |
|---|---|
| SQL injection | Drizzle parameterises; hand-written SQL uses bound `sql` templates; lint rule bans concatenation, `Array.join`, and `sql.raw` inside templates |
| XSS | React escapes by default; `dangerouslySetInnerHTML` banned by ESLint with no exceptions; long text renders as plain text with linkification |
| CSV injection | Values beginning `=`, `+`, `-`, `@`, tab, CR prefixed with `'` on export |
| API keys | SHA-256 + server-side pepper, constant-time compare, plaintext shown exactly once |
| Webhooks | HMAC-SHA256 over `{timestamp}.{body}`, constant-time verify, timestamps > 5 min rejected |
| Rate limiting | Sliding window, per user and per key. **Fails open** when Redis is unreachable |
| PII | Item content never logged. Sentry `beforeSend` strips request bodies and all `values`/`effective_values`. PostHog gets event names and ids only. Session replay masks all grid cell text |
| Cross-tenant probing | Returns 404, never 403 — a 403 would confirm the resource exists |

---

## Part 6 — User interface

### 6.1 The grid keyboard map (normative)

Implement exactly. Users bring these from Excel and any deviation reads as a bug.

| Key | Action |
|---|---|
| `↑ ↓ ← →` | Move selection one cell |
| `Tab` / `Shift+Tab` | Commit, move right / left (wraps to next row) |
| `Enter` / `Shift+Enter` | Commit, move down / up |
| `Ctrl/⌘ + ↑↓←→` | Jump to the edge of the data region |
| `Shift + ↑↓←→` | Extend selection |
| `Ctrl/⌘ + Shift + ↑↓←→` | Extend selection to edge |
| `Ctrl/⌘ + A` | Select all loaded rows |
| *any printable char* | Replace cell contents, enter edit mode |
| `F2` / double-click | Edit in place, cursor at end |
| `Esc` | Cancel edit / collapse selection |
| `Delete` / `Backspace` | Clear selected cells |
| `Ctrl/⌘ + C` / `X` / `V` | Copy / cut / paste TSV |
| `Ctrl/⌘ + D` | Fill down from the top row of the selection |
| `Ctrl/⌘ + Z` / `Shift+Z` | Undo / redo (≥ 50 operations, bulk included) |
| `Ctrl/⌘ + Enter` | Open the selected row's detail panel |
| `Space` | Toggle a checkbox cell / expand a hierarchy row |
| `Ctrl/⌘ + K` | Command palette |
| `/` | Focus the filter bar |

**Clipboard contract.** Copy writes `text/plain` as TSV (tab-delimited, `\n` rows, values
containing tabs or newlines quoted) and `text/html` as a table. Paste reads TSV, maps onto the
selection rectangle (a single selected cell extends down and right), coerces per destination
column type, and previews non-convertible values before committing. Pasting more rows than
exist offers to create the extra items rather than silently truncating.

### 6.2 Design system

| Token | Value |
|---|---|
| Primary | Indigo `#4F46E5` — actions, active nav, focus rings |
| Accent | Amber `#F59E0B` — inherited-value markers, propagation, warnings |
| Success | Emerald `#10B981` — 100% completeness, valid, committed |
| Danger | Rose `#E11D48` — destructive actions, validation errors |
| Info | Sky `#0EA5E9` — preview states, hints |
| Completeness ramp | Rose (0–33) → Amber (34–66) → Emerald (67–99) → Emerald-600 (100). Three stops plus a done state, never a rainbow gradient |
| Font — UI | Inter var, `-0.011em` tracking at body size |
| Font — grid | Inter with `tabular-nums`. **Mandatory in grid cells** — proportional digits make number columns unreadable |
| Type scale | 11 / 12 / 13 / 14 / 16 / 20 / 24 / 32. **Grid body is 13px** |
| Radius | 6px default, 4px in grid, 10px on modals and panels |
| Row heights | short 32px · medium 40px · tall 56px |
| Borders | 1px Slate-200. The grid uses borders, not zebra striping — stripes fight cell selection highlighting |
| Motion | 120ms state changes, 200ms panels. **Zero animation inside the grid viewport** |
| Dark mode | Phase 2, but tokens are CSS variables from day one so it is not a rewrite |

**Tone:** dense and data-forward, but calm. Strata shows more per screen than Monday, so it
cannot also be as loud. Colour carries meaning — status, completeness, validity, inheritance —
and is never decorative. Reference aesthetics: **Linear** for density and keyboard-first
restraint, **Airtable** for grid feel, **Stripe Dashboard** for information hierarchy,
**Notion** for side panels. Explicitly *not* Monday's saturated colour blocks, which read as
friendly at 30 items and as chaos at 3,000.

### 6.3 Screens

**Workspace shell.** Fixed 240px left sidebar collapsible to a 56px icon rail. No top nav —
vertical space belongs to data. Sidebar holds the workspace switcher, `⌘K` trigger, Item Types
(each expanding to its saved views), Trees, Activity, Import, and the user menu.

**Item Type Builder.** Centred single column, max 720px — deliberately *not* a split-pane
schema editor, because that framing alone signals "database tool." Preset picker first, then
icon + name, description, field list, `> Advanced`, sticky footer.

**Grid view.** View bar (saved views dropdown, Grid/List/Board switcher, field picker, sort,
filter, export) · sticky header row with field-type icons and sort indicators · row gutter with
expander chevron, selection checkbox, hover actions · cells at 32px · a permanently pinned
new-item row at the bottom · footer bar with total count, selection count, aggregate
completeness, and the bulk-edit entry point.

*Empty states teach.* No items is not a shrug — it is a three-option card: "Add your first
item," "Import a spreadsheet," "See an example." Import is as prominent as manual creation,
because the persona has a file.

**Bulk edit preview modal.** States the operation, the count, skipped items with reasons, and a
before/after table. Commit button names the count.

**Item detail panel.** Right side panel, 480px, resizable to 720px, full screen on tablet,
deep-linkable. Completeness bar with click-to-focus missing-field links · tree chips ·
fields by collapsible field group · variant banner · sub-items · activity.

**Board view.** The Contributor's screen. Horizontally scrolling columns grouped by any
`select` or `user` field. Cards show title, avatar, due date, up to two configured fields, and a
thin completeness bar.

**List view.** The familiar on-ramp for switchers and the best surface for reading the work
hierarchy. Indent-based nesting with expander chevrons.

**Tree manager.** Two panes — node hierarchy left, items in the selected node right with an
"Include sub-categories" toggle. Drag items onto a node to assign.

**Import flow.** Four steps with a persistent progress header, navigable backward without
losing state: Upload → Map → Validate → Commit. Nothing writes until step 4.

**Shared view.** Simplified chrome, no sidebar, no bulk tools, only the view's visible fields.

### 6.4 Progressive disclosure

| Tier | Contents | Where |
|---|---|---|
| **1 — always visible** | Item name, fields, types, required toggle, the grid | Default screens |
| **2 — one click away** | Field groups, filters, sort, view config, tree assignment | Advanced disclosure or toolbar popover |
| **3 — opt-in per Item Type** | Variants, axes, shared/variant marking, completeness config | Advanced; the *concept* stays invisible until enabled |

**The invisibility rule:** a user never encounters the words "variant," "axis," "inheritance,"
or "completeness" until they have either enabled the feature or opened an item that uses it. A
workspace using none of them presents as a slightly nicer Monday.

### 6.5 In-product concept explanations

Each hard concept explains itself where first encountered — a dismissible inline card, once per
concept per user, with a one-sentence *what* and a concrete *why* drawn from the workspace's own
preset. Never modal. Re-accessible via a `?` on the section header.

> **Variants let one item have versions that share most of their data.** A "Q3 Launch Campaign"
> can have EMEA, APAC, and AMER versions. The tagline and budget are shared — change them once
> and all three update. Launch date and local assets belong to each version.

Documentation is not a substitute. If the explanation only exists in a help centre, it does not
count as shipped.

### 6.6 Responsive

| Breakpoint | Behaviour |
|---|---|
| ≥ 1280px | Full grid, sidebar expanded, detail panel side-by-side |
| 1024–1280px | Sidebar auto-collapses to icon rail; detail panel overlays |
| 768–1024px | Grid horizontally scrollable with title column pinned; bulk tools in a bottom sheet; detail full-screen |
| < 768px | Read-mostly. List and board only. **No pretense of spreadsheet editing on a phone.** |

### 6.7 Accessibility

Target WCAG 2.2 AA. Contrast ≥ 4.5:1 text, ≥ 3:1 borders and icons. **Completeness is never
encoded by colour alone** — the % is always present. Inherited vs. overridden variant values are
distinguishable by **two channels** (colour/weight *and* icon/bar), never colour alone.
`role="grid"` with `aria-rowcount` reflecting the true total, not the virtualised window —
virtualisation must not lie to a screen reader about how much data exists. `aria-live="polite"`
for selection changes and bulk results; `assertive` for validation errors only.

**Known gap:** a virtualised 10,000-row grid is inherently difficult with a screen reader. The
v1 mitigation is List view, which is fully accessible and covers the same data. A stated
limitation, not an oversight.

---

## Part 7 — Performance budgets

Acceptance criteria, not aspirations. Verified against a seeded 100k-item × 40-field workspace.

| Operation | p95 target | Scale point |
|---|---|---|
| Filtered + sorted page, 100 rows | **< 300 ms** | 100k items, 40 fields, 8 clauses |
| Keystroke → rendered filtered result | **< 500 ms** | incl. 300ms debounce |
| Text search | **< 400 ms** | 100k items |
| Subtree filter (node + descendants) | **< 300 ms** | depth 8, 50k items in subtree |
| Item detail load | **< 200 ms** | all fields + activity |
| Single cell write confirmed | **< 150 ms** | optimistic UI renders instantly |
| Bulk commit, 500 items | **< 3 s** | synchronous |
| Bulk commit, 10k items | **< 60 s** | async with progress |
| Import validate, 10k rows | **< 30 s** | async |
| Grid scroll | **60 fps** | 10k rows loaded |
| App shell TTI | **< 2 s** | cold, simulated Fast 3G |

A build that misses these has not met the requirement, however complete the feature list.

---

## Part 8 — Implementation status

As of commit `343d707`, branch `claude/strata-platform-9htu5e`.

### 8.1 Built and verified

| Area | Detail |
|---|---|
| **Schema** | All 22 tables, GiST indexes on both ltree paths, trigram index on `search_text`, partial indexes per `item_field_index` value column, CHECK constraints on variant placement |
| **Tenant isolation** | RLS enabled *and forced* on all 20 tenant tables; `withWorkspace()` pinning via `set_config(..., true)`; app connects as non-owner `strata_app` role |
| **Auth** | Supabase session, local user upsert claiming invited rows, workspace resolution, membership check, guest scope loading, API keys with pepper + constant-time compare, guest API rejection |
| **Permissions** | Single `can()` across 49 actions returning typed denials with specific messages |
| **Change sets** | preview / commit / undo across all nine operations; snapshot-based entries; `STALE_PREVIEW`; subtree expansion for reparent and delete |
| **Fields** | All 14 types with spreadsheet-tolerant coercion; non-blocking validation; soft-delete with 30-day restore; type-change conversion preview |
| **Search** | Filter compiler with no string-concatenation path; keyset pagination; `PostgresSearchProvider` behind the interface; projection index maintenance |
| **Grid** | Virtualised render, Zustand selection, keyboard map, all 14 editors, TSV clipboard, fill-down and fill-handle, undo, column resize/reorder/pin, completeness column |
| **App** | Workspace shell with Item Type sidebar, grid page at `/w/[slug]/types/[typeId]`, search, incomplete-only toggle, undo toasts, setup diagnostics |
| **API** | 7 routes: items list, item-types list/create, change-sets create/get/commit/undo, health |
| **Tests** | 116 passing across 8 files, including all three named invariants |

The three named tests, all passing:
- **Tenant isolation** (12) — unfiltered reads, a join forgetting to scope the joined side, fail-closed with no workspace pinned, `SET` vs `SET LOCAL` leakage, and an assertion that the test connection itself is unprivileged.
- **Undo fidelity** (11) — all nine operations, snapshot → apply → undo → byte-identical, covering `effective_values`, `item_field_index`, `completeness_pct`, `path`, tree memberships, denormalised counts.
- **Projection consistency** (5) — asserted in *both* directions, so orphaned index rows are caught, not just missing ones.

### 8.2 Not built

List view · Board view · Item detail panel · Item Type Builder UI · Tree manager · Variant
generation UI · Import flow · Export · Saved views UI · `/share/[token]` · Activity feed ·
Notifications · Remaining `/api/v1` surface · Webhooks · OpenAPI generation · Inngest jobs ·
Concept hints · Command palette · 100k perf fixture · Deployment pipeline.

### 8.3 Known divergences

Three correctness problems are tracked in `SPEC_RECONCILIATION.md` and should be fixed before
further work:

1. **Variant inheritance is implemented backwards** relative to Tech Spec §2.5.
2. **Completeness counts optional fields**, where the PRD defines it as required-only.
3. **Filtering a non-indexed field auto-indexes inline** instead of returning `FIELD_NOT_FILTERABLE`.

Plus wire-format divergences (snake_case bodies, `data`/`meta` envelope, `X-Workspace-Id`
header, error-code names), the `member`/`editor` role rename, several column renames, and
limits that are all more permissive than specified.

---

## Part 9 — Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **The grid is the hardest thing in the product.** Clipboard interop, rectangular selection, fill-down, undo over bulk ops, virtualisation — routinely underestimated by an order of magnitude. | High | Build the grid first. Use TanStack Table + Virtual rather than writing virtualisation from scratch. If the spike slips, cut Board view before cutting grid fidelity. |
| 2 | **Three hierarchy axes may be one too many to teach.** | High | The v1 constraint (no variants inside the work hierarchy) exists to reduce interaction between axes. Test comprehension before build completes; if users conflate axes, hide variants behind per-type opt-in. |
| 3 | **Saved views are not a security boundary.** Field subsetting controls presentation. A Guest with API access could read hidden fields. | High | Say so explicitly in-product wherever a view is shared. Gate Guest API access off entirely until real field-level ACLs ship in Phase 2. Do not let sales imply otherwise. |
| 4 | JSONB + projection storage may not hold at the stated filter budgets under real field counts. | Medium | Load-test at 100k × 40 before feature-complete. The `SearchProvider` escape hatch is designed in, not bolted on. |
| 5 | The wedge persona may be wrong — the sharper pain may be ops/structured-records rather than agencies. | Medium | Customer discovery before build. Presets are cheap to reorder; positioning is not. |
| 6 | Variant inheritance introduces subtle bugs (stale effective values, propagation races) expensive to debug in production. | Medium | Deterministic recompute path, property tests, and an admin-visible "recompute this subtree" action. |
| 7 | Competitors ship a lookalike. Monday adding connected boards + rollups narrows the gap. | Medium | The moat is the combination, not any one feature. |

---

## Part 10 — Success metrics

| Metric | Target |
|---|---|
| **Activation — schema created** | 60% of new workspaces create ≥ 1 custom Item Type within 24h |
| **Activation — time to first Item Type** | Median ≤ 2 min from "New Item Type" click |
| **Differentiator adoption** | 40% of active workspaces use ≥ 1 of {variants, custom tree, bulk edit > 20 items} within 14 days |
| **Grid engagement** | 50% of weekly-active workspaces perform ≥ 1 bulk operation per week |
| **Bulk trust** | Undo rate on bulk operations < 10% (high undo = the preview is not being read) |
| **Import success** | 80% of started imports reach commit |
| **Retention** | 40% of workspaces active in week 4 |
| **Performance SLO** | 99% of filtered view loads under 300 ms p95 |
| **Concept comprehension** | ≥ 4/5 usability participants correctly explain a variant after 15 min unaided |
| **Business** | 15 paying workspaces within 90 days of pricing launch |

The two that matter most for the thesis are **time to first Item Type** and **differentiator
adoption**. Strong retention with near-zero differentiator adoption means users adopted a
slower Monday, and the strategy is wrong — the fix is not more features.

---

## Part 11 — Out of scope for v1

| Excluded | Reason |
|---|---|
| Native iOS/Android apps | Primary persona is desktop-bound; responsive web to tablet covers the contributor |
| Timeline/Gantt, calendar views | Expected by buyers, not differentiating |
| Automations builder | Automations over a schema that is still settling is churn |
| Dashboards / reporting / charts | Not the wedge |
| Native integrations (Slack, GitHub, Calendar) | API + webhooks let early adopters self-serve; each native integration is weeks of ongoing maintenance |
| Any AI feature | Would distract from the differentiator and add cost/latency before PMF |
| Stripe billing | Structured for (`workspaces.plan`), not wired up |
| Field-level permissions as a security boundary | Phase 2. v1 contains the gap by denying Guests API access |
| More than one custom category tree | Proves the multi-tree model without the UI complexity |
| Variants nested in the work hierarchy | Keeps the mental model teachable |
| Comments / threaded discussion | Removes @-mentions from v1 notifications; decide before build |
| Time tracking, sprints, docs, wiki, chat | Breadth is Monday's game. Strata wins on depth of model or not at all |
| SSO/SAML, 2FA | Phase 2 |
| SOC 2 / HIPAA | 6+ months and meaningful spend for a segment v1 is not targeting |
| Real-time multiplayer cursors | React Query refetch-on-focus is sufficient for v1 |

### Phase 2, in rough priority order

Timeline/Gantt · Automations builder · Slack/GitHub/Calendar integrations · **Field-level
permissions as a real boundary** · Stripe billing · Calendar view · Dashboards · View-scoped
completeness · Unlimited custom trees · Variants in the work hierarchy · AI: suggest an Item
Type from pasted data · AI: natural-language filter construction.

---

## Part 12 — Open questions

- **Pricing model.** Per-seat is conventional, but value scales with item count and schema complexity, not headcount. Decide before the Stripe work.
- **Guest seats — free or paid?** Charging per guest kills the agency wedge; not charging invites abuse.
- **Does v1 need comments?** Out of scope above, which also removes @-mentions from notifications. Guest approval workflows arguably require both.
- **Item Type change management.** When a type changes, do existing items migrate immediately, lazily, or on explicit action? Current assumption is immediate with a preview — confirm it holds at 50k items.
- **Is one custom tree a real product or an obvious limitation?**
- **Self-serve or design-partner launch?** The concept load argues for hand-held onboarding with 5–10 design partners first.
- **Undo window length.** 60s toast + 24h from the activity feed is proposed. Is 24h enough for someone who finds a bad import on Monday morning?

---

*Source documents: `PRD.md` · `TECH_SPEC.md` · `API_DESIGN.md` · `UI_UX_NOTES.md` ·
`LAUNCH_CHECKLIST.md` · `SPEC_RECONCILIATION.md`. Build instructions: `../CLAUDE.md`.*
