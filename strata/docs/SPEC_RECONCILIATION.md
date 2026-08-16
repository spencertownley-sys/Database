# Spec Reconciliation

**Date:** 2026-08-15
**Status of the build at the time of writing:** commit `a5b86f0`, branch `claude/strata-platform-9htu5e`

> **RESOLVED — 2026-08-15, branch `claude/strata-spec-reconciliation-f0ku1c`.**
> Every item in §1–§5.2 has been fixed in the §7 order, verified against the
> live app, and committed with the three Tech Spec §8 tests passing throughout.
> §8 at the bottom of this document records the resolution, including the two
> divergences that were resolved by deliberate decision rather than by
> matching the spec letter-for-letter.

---

## Why this document exists

The first build pass implemented Steps 1–7 (foundation, change sets, filter compiler, grid) from
`CLAUDE.md` alone. The five companion documents were referenced by path but their contents were not
available to that session, so every specification they own — the exact column list, the error
envelope, the wire format, the role names, the performance budgets, the grid key map, the variant
semantics — was **inferred from the descriptions `CLAUDE.md` gives of them**.

The documents are now in `docs/`. This is the diff between what was inferred and what was specified.

**It is not a list of bugs.** Most of the code is sound and several divergences are defensible
alternatives. But three of them are genuine correctness problems, and the wire-format ones get more
expensive to change with every endpoint added. Read §1 before writing new code against the existing
services.

Verification status is marked on each item: **[verified]** means the current behaviour was confirmed
by reading the code or running it; **[from spec]** means the divergence is asserted from the document
and has not been re-confirmed against the implementation.

---

## 1. Correctness — fix before building further

### 1.1 Variant inheritance semantics are inverted [verified]

**The single most consequential divergence in the build.**

Tech Spec §2.5 defines resolution as:

```
if f.inheritance == 'shared':
    out[f.key] = model.values[f.key]                        # ALWAYS the model's
else:
    out[f.key] = item.values[f.key] ?? model.values[f.key]   # override, else inherit
```

So `shared` means **owned by the model and read-only on the variant** — API Design §4 returns
`422 FIELD_READ_ONLY` when a client writes a `shared` field on a variant. `variant` means
**inherit by default, override permitted**.

`src/server/services/variants.service.ts` implements the exact opposite on both arms: `variant`
fields never inherit at all, and `shared` fields are the ones that inherit-with-override. The
consequence is not subtle — a freshly generated variant reads as far less complete than it should,
and overriding a shared field silently succeeds where the API contract says it must be refused.

Three further points in the same function:

- **Default is wrong.** Tech Spec §2.2: `inheritance text NOT NULL DEFAULT 'variant'`. The schema
  defaults to `'shared'`.
- **Axis values are missing their explicit rule.** §2.5 ends with a final pass forcing
  `out[axis.field_key] = item.values[axis.field_key]` for every declared axis, regardless of
  inheritance. Not implemented.
- **The `?? model.values[key]` fallback is a nullish coalesce.** The current code additionally
  requires the model value to be non-null before inheriting, which is a different (and stricter)
  rule than specified.

**Fix:** rewrite `computeEffectiveValues` directly from the §2.5 pseudocode, flip the schema default,
add the axis pass, and add `FIELD_READ_ONLY` to the write path. The existing property test will need
inverting with it.

### 1.2 Completeness counts fields it should not [verified]

PRD §4.7: *"An item's completeness = (filled required fields ÷ total required fields)."*

`completeness.service.ts` counts required fields **plus** any optional field whose
`countsTowardCompleteness` flag is set, and that flag defaults to `true`. So on a preset type where
most fields are optional, the denominator is far larger than specified and every item reads as less
complete than it is. Since completeness is filterable, sortable, aggregated per group, and the basis
of the "incomplete only" toggle, this shifts a number the whole product is organised around.

The `countsTowardCompleteness` field is itself an invention — Tech Spec §2.2 has exactly one flag,
`required_for_completeness`. The two concepts should collapse back into one.

**Fix:** drop `countsTowardCompleteness`, rename `required` → `required_for_completeness`, and count
required fields only. Note the title is also currently counted as a pseudo-required field; the spec
does not include it, so it should come out of the denominator too.

### 1.3 Filtering a non-indexed field silently auto-indexes instead of erroring [from spec]

API Design §4.1 and Tech Spec §6.2 both require a clause on a non-indexed field to return
`400 FIELD_NOT_FILTERABLE`, with `details.action` naming the PATCH that would index it. The rationale
is stated explicitly: *"A filter that quietly takes eight seconds trains users to distrust the
product,"* and it is what keeps the §6.1 budgets enforceable.

The build instead auto-enables `is_indexed` on first filter and backfills inline
(`ensureFieldsIndexed` in `fields.service.ts`). On a large workspace that turns a user's first filter
into a synchronous full-table backfill — the exact latency spike the error exists to prevent.

Note the two documents are in mild tension: Tech Spec §2.2 says `is_indexed` *"is set automatically
the first time a user filters or sorts on the field (triggering a backfill job)."* The reconciliation
that satisfies both: **the API errors**, and the error's action triggers an async backfill job the
user opts into. Never inline.

Also missing: §2.2 requires `select`, `multi_select`, `date`, `datetime`, `user`, and `checkbox`
fields to be **always-on indexed**, because those are overwhelmingly what people filter by.

---

## 2. Wire format — cheap now, expensive per endpoint added

None of these are wrong in isolation; all of them are wrong against a published contract that the
app is supposed to dogfood. Every endpoint built before they are fixed is another migration.

| # | Spec | Built | Where |
|---|---|---|---|
| 2.1 | Bodies are **`snake_case`** (`item_type_id`, `effective_values`, `completeness_pct`) | camelCase, straight from Drizzle | API Design §1.2 |
| 2.2 | Collections: `{ data: [...], meta: { cursor, has_more, total } }` | `{ items, nextCursor, total }` | API Design §1.2 |
| 2.3 | Workspace via **`X-Workspace-Id: <uuid>`** header; missing → `WORKSPACE_REQUIRED`. No default-workspace fallback | `?workspace=<slug>` query param or `X-Strata-Workspace` | API Design §1.1 |
| 2.4 | Error envelope key is **`request_id`** | `requestId` | API Design §10 |
| 2.5 | `?expand=` and `?fields=` on read endpoints | not implemented | API Design §1.2 |
| 2.6 | `total` is `null` on filtered queries over 10,000 rows | always computed when asked | API Design §1.2 |
| 2.7 | API keys are `sk_live_...`; scopes are `items:read`, `items:write`, `schema:read`, … | `sk_strata_...`; scopes are `read`/`write`/`admin` | API Design §9 |
| 2.8 | `/api/health` returns `{ status, db, redis, version }` | `{ status, database, latencyMs }` | API Design §1.0 |

### 2.9 Error codes [from spec]

The built `ERROR_CODES` map was invented. Renames needed:

| Built | Spec |
|---|---|
| `VALIDATION_FAILED` | `VALIDATION_ERROR` |
| `UNAUTHENTICATED` | `UNAUTHORIZED` |
| `GUEST_API_DENIED` | `GUEST_API_FORBIDDEN` |
| `CHANGE_SET_ALREADY_COMMITTED` | `ALREADY_COMMITTED` (422, not 409) |
| `CHANGE_SET_ALREADY_UNDONE` | `ALREADY_UNDONE` |
| `BULK_LIMIT_EXCEEDED` | `TARGET_TOO_LARGE` |
| `TREE_NODE_HAS_ITEMS` | `NODE_HAS_MEMBERS` |
| `TREE_LIMIT_EXCEEDED` | `TREE_LIMIT_REACHED` |
| `ITEM_TYPE_IN_USE` | `TYPE_IN_USE` |
| `REQUIRED_FIELD_NEEDS_ACKNOWLEDGEMENT` | `REQUIRES_ACKNOWLEDGMENT` |
| `FIELD_TYPE_CHANGE_UNSAFE` | `CONVERSION_REQUIRES_CONFIRMATION` |
| `VARIANT_CANNOT_HAVE_CHILDREN`, `VARIANT_MODEL_CANNOT_BE_NESTED` | both collapse to `VARIANT_CONSTRAINT` |
| `OUT_OF_SCOPE` | `FORBIDDEN` with `details.required_role`, or `NOT_FOUND` for cross-tenant |

Missing entirely: `FIELD_NOT_FILTERABLE`, `WORKSPACE_REQUIRED`, `FILTER_TOO_COMPLEX`,
`OPERATION_NOT_APPLICABLE`, `PREVIEW_EXPIRED`, `UNDO_WINDOW_EXPIRED`, `STALE_WRITE`, `HAS_CHILDREN`,
`CANNOT_UNDO_SCHEMA_CHANGE`, `NOT_VARIANT_ENABLED`, `INVALID_VARIANT_AXIS`, `FIELD_READ_ONLY`,
`SERVICE_UNAVAILABLE`.

Also unimplemented: `details` must always be an **object**, never an array, and
`X-Request-Id` must appear as a response header on every response (currently only on some paths).

### 2.10 Role naming [from spec]

Tech Spec §3.1: **owner · admin · member · guest · viewer**. The build uses `editor` where the spec
says `member`. The capability matrix itself matches — members cannot change Item Types or trees —
so this is a rename, but it reaches the DB enum, the permission matrix, and every seeded fixture.

---

## 3. Data model gaps [from spec]

Against Tech Spec §2. Renames first, since they touch the most code:

| Spec column | Built as |
|---|---|
| `items.variant_parent_id` | `variant_of_id` |
| `items.archived_at` | `deleted_at` |
| `items.position` (numeric) | `order_key` (text) |
| `item_types.label` | `name` |
| `item_types.archived_at` | `deleted_at` |
| `fields.position` (integer) | `order_key` (text) |
| `fields.required_for_completeness` | `required` + `counts_toward_completeness` |
| `views.type` | `kind` |
| `tree_nodes.label`, `trees.label` | `name` |

> On `position`: the spec says `numeric`, the build uses a string fractional index. The string form is
> arguably the better engineering choice (it never needs rebalancing), but `numeric` with fractional
> midpoints is what every other document assumes. Worth a deliberate decision rather than a silent
> divergence.

**Missing columns:** `items.depth` (denormalised `nlevel(path) - 1`, used by the `depth` filter
pseudo-field), `item_types.preset_source`, `trees.position`, `field_groups.position`.

**Missing indexes:** `items_values_gin` (`GIN (effective_values jsonb_path_ops)`) and
`items_keyset_idx` (`(workspace_id, item_type_id, created_at DESC, id DESC)`). The projection
indexes were also built as `(field_id, value)` rather than the specified
`(workspace_id, field_id, value)`.

**FK behaviours:** spec has `items.parent_id ON DELETE RESTRICT` and
`tree_nodes.parent_id ON DELETE RESTRICT`; both were built as `CASCADE`. This matters — `RESTRICT`
is what forces the `HAS_CHILDREN` / `NODE_HAS_MEMBERS` dispositions rather than silently taking a
subtree with it.

**`users.email`** should be `citext`; built as `text` with a `lower()` unique index. Functionally
equivalent, cosmetically different.

### 3.1 `change_entries` is a different shape [verified]

Tech Spec §2.7 specifies one row **per item per field**: `bigserial` PK, `field_key`, `before`,
`after` as single values, with `field_key` null for whole-item operations. `GET /change-sets/:id/entries`
(API Design §5) returns exactly that shape, paginated.

The build stores one row **per item** with a complete `ItemSnapshot` in `before`/`after`, and a `uuid`
PK. The reasoning is recorded in `changeSets.service.ts` and is real — snapshots make undo a swap
rather than nine inverse implementations, and they are what let the undo-fidelity test pass
byte-for-byte. But it diverges from a documented public endpoint, and `bigserial` was chosen in the
spec deliberately for a high-volume table.

**Recommendation:** keep the snapshot internally, but derive per-field entries for the API response
so the published contract holds. Decide explicitly; do not leave it implicit.

---

## 4. Limits and thresholds [from spec]

Every one of these is currently more permissive than specified, which means the build will accept
requests the contract says it must reject:

| Limit | Spec | Built |
|---|---|---|
| Filter clauses | 20 | 100 |
| Filter nesting depth | 4 | 8 |
| Sort keys | 3 | 8 |
| Change-set target | 10,000 items | 50,000 |
| Preview expiry | 1 hour | 30 minutes |
| Undo window | 24 hours (`UNDO_WINDOW_EXPIRED`) | unbounded |
| Undo toast | 60 s with a draining progress line | 12 s |
| Page size | default 100, max 500 | default 100, max 500 ✓ |

---

## 5. UI and interaction [from spec]

### 5.1 Grid keyboard map is incomplete

UI/UX §5.1 is explicitly normative — *"Implement it exactly; users bring these bindings with them
from Excel and any deviation reads as a bug."* Missing from `useGridKeyboard.ts`:

- `Ctrl/⌘+Enter` — open the selected row's detail panel
- `Space` — toggle a checkbox cell / expand a hierarchy row
- `/` — focus the filter bar
- `Ctrl/⌘+K` — command palette

Also specified and not built: pasting more rows than exist should **offer to create the extra items**
rather than clipping (the build clips silently), and paste must **preview non-convertible values
before committing** (the build commits and flags them afterwards).

### 5.2 Design tokens diverge

UI/UX §2 specifies exact hex values — Indigo `#4F46E5`, Amber `#F59E0B` (reserved for inherited
values and propagation), Emerald `#10B981`, Rose `#E11D48`, Sky `#0EA5E9`. The build uses an
invented oklch palette. Also:

- Grid body text must be **13px**; built at 14px.
- Row heights **32 / 40 / 56**; built at 28 / 34 / 48.
- `font-variant-numeric: tabular-nums` is **mandatory in grid cells** — currently applied only to
  numeric columns.
- The completeness ramp has four defined stops (Rose 0–33 → Amber 34–66 → Emerald 67–99 →
  Emerald-600 at 100); the build uses three thresholds at different boundaries.
- Borders, not zebra striping — *"stripes fight cell selection highlighting."* Correct in the build.

### 5.3 Presets do not match

UI/UX §3.2 gives exact field lists for all six presets. The built `presets.ts` invented its own. In
particular: **Campaign ships with variants pre-enabled on Region**, and **Product Variant ships with
two axes (Region, Size)** — the built version has one preset named "Product" with different fields.
The preset picker screen (six cards shown *before* the builder) is also not built.

### 5.4 Not yet built at all

`/share/[token]` read-only route · the external-sharing warning copy (a 🔒 launch blocker, PRD §9
Risk 3) · concept-hint cards (§7) · the three-axes diagram · Item Type builder · Advanced disclosure
· list view · board view · item detail panel · tree manager · import flow · command palette.

---

## 6. What the build got right

Worth recording so it does not get rewritten:

- **Tenant isolation.** RLS enabled *and forced* on all 20 tenant tables; the app connects as a
  non-owner role; one test asserts the test connection has neither `SUPERUSER` nor `BYPASSRLS`, so
  the suite cannot become theatre. This exceeds what the documents ask for and matches their intent.
- **All three named tests from Tech Spec §8 exist and pass** — tenant isolation (12), undo fidelity
  across all nine operations (11), projection consistency asserted in both directions (5).
- **The filter compiler has no string-concatenation path.** Field keys resolve to `field_id` through
  the schema; operators dispatch through a closed union; values bind. ESLint fails the build on
  concatenation, `Array.join`, or `sql.raw` inside a `sql` template.
- **Keyset pagination**, with the cursor predicate built from the same `SortTerm[]` as `ORDER BY` so
  the two cannot drift.
- **Selection in Zustand with cells subscribing to a packed-integer slice**, exactly as Tech Spec
  §6.3 requires.
- **Non-blocking validation** into `invalid_values`, per PRD §6.4.
- **Change sets as the universal write path**, including single-cell edits with `item_count=1`.
- **Field coercion is genuinely spreadsheet-tolerant** — thousands separators, currency symbols,
  parenthesised negatives, European decimals, Excel serial dates, `Name <email>` — with unit tests
  for each.

---

## 7. Suggested order of work

1. **§1.1 variant semantics** — everything about variants is wrong until this is right, and it is a
   contained rewrite of one function plus its tests.
2. **§1.2 completeness** — one function, one schema change, but it moves a number the product is
   built around.
3. **§2 wire format** — do it before adding endpoints, not after. Renames, envelope, header-based
   workspace scoping, error codes.
4. **§3 data model renames** — one migration, mechanical, and it unblocks matching the API contract.
5. **§1.3 `FIELD_NOT_FILTERABLE`** — small, and it is what keeps the performance budgets enforceable.
6. **§4 limits** — trivial constant changes.
7. Then resume the step order in `CLAUDE.md` from Step 8.

A full restart is not necessary and would discard the isolation, undo, and projection work, which is
the part that took the longest to get right and is the part the launch checklist marks 🔒 BLOCKER.

---

## 8. Resolution record

Fixed in the §7 order on `claude/strata-spec-reconciliation-f0ku1c`, one commit per section, with
typecheck, lint, the full test suite (154, up from 116), and `next build` green at every commit.
The isolation, undo-fidelity, and projection-consistency tests were never red.

| Item | Resolution |
|---|---|
| §1.1 variant semantics | Rewritten from §2.5: `shared` = model's value, read-only on variants (`FIELD_READ_ONLY` on a single-item write, skip-with-reason in bulk); `variant` = inherit-until-overridden by key presence; axis pass added; schema default flipped to `'variant'`. New unit + property suites pin every arm. |
| §1.2 completeness | Filled-required ÷ total-required only. `counts_toward_completeness` dropped, `required` → `required_for_completeness`, title out of the denominator. |
| §1.3 auto-index | Filter/sort on a non-indexed field → `400 FIELD_NOT_FILTERABLE` with `details.action`; indexing happens on the explicit `PATCH` (with backfill); `select`/`multi_select`/`date`/`datetime`/`user`/`checkbox` always-on indexed and backfilled by migration. |
| §2 wire format | snake_case bodies/params converted once at the route boundary (user-keyed bags untouched), `{data, meta}` envelope with `total` null past 10k, `X-Workspace-Id` header + `WORKSPACE_REQUIRED`, `request_id`, §10 error-code table verbatim, `sk_live_` keys with §9 scopes, §1.0 health shape, `expand=`/`fields=`, §4.1 `op`/`children` filter grammar, §4 param names and `sort=key:dir`. |
| §2.10 roles | `editor` → `member` via `ALTER TYPE … RENAME VALUE`; matrix and messages follow. |
| §3 data model | All renames applied in one data-preserving migration; `items.depth` (maintained on write and reparent), `trees.position`, `items_values_gin`, `items_keyset_idx`, workspace-led projection indexes, `citext` email, bigserial `change_entries` PK, `RESTRICT` on both `parent_id` FKs. |
| §3.1 change entries | **Deliberate decision:** entries stay whole-item snapshots internally (undo is a swap, and the byte-identical undo test depends on it); `GET /change-sets/:id/entries` derives the published per-item, per-field rows at read time. |
| §4 limits | 20 clauses / depth 4 (`FILTER_TOO_COMPLEX`), 3 sort keys, 10k target (`TARGET_TOO_LARGE`), 1h preview (`PREVIEW_EXPIRED`), 24h undo window (`UNDO_WINDOW_EXPIRED`), 60s undo toast with a draining line. |
| §5.1 key map | `Ctrl/⌘+Enter`, `Space`, `/`, `Ctrl/⌘+K` added; paste offers to create overflow rows and previews non-convertible values before committing; multi-set gestures undo as one step. |
| §5.2 tokens | §2 hex palette, 13px grid body, 32/40/56 row heights, tabular-nums across the grid, four-stop completeness ramp. |
| §5.3 presets | Campaign ships Region with variants pre-enabled; Product Variant gains Category/Status alongside its two axes; Record type / Reference ID / Owner / Due date labels; Blank is Title-only. |
| Step 8 | List view (hierarchy + variant nesting, inline title edit), board view (option-ordered columns, drag-between-columns via change sets, shared undo toast), item detail panel (field groups, click-to-focus missing links, breadcrumb, tree chips, variant banner with two-channel inherited/overridden marking, revert, activity feed), deep link at `/w/:slug/items/:id`, plus `GET/PATCH/DELETE /items/:id` and `GET /change-sets`. |

**The one deviation kept, on purpose:** `position` is the spec's column name but remains a
*fractional string* rather than `numeric`. The string form never needs rebalancing, sorts with plain
collation, and serialises as an opaque ordering token; `numeric` buys nothing but midpoint
arithmetic and a rebalancing failure mode. Every document's *uses* of `position` (sibling ordering,
drag) behave identically.

**Steps 9–15 are now built** — tree manager with dispositions and rollups, guided variant
generation as one change set (with the model flip riding the same set), CSV import/export with the
one-change-set commit and the 5,000-row round-trip test, saved views + `/share/[token]` behind an
`app_resolve_share_token` SECURITY DEFINER lookup, guest-scoped listings, the activity page,
the notification centre, webhook delivery with §12 signing and the 20-failure auto-disable,
`/api/openapi` with a coverage test that fails the build on route/spec drift, the ⌘K palette,
concept hints, error pages, and the 100k perf fixture with the §6.1 budget + EXPLAIN gates
(`npm run test:perf`).

**Deliberate adaptations to this build's environment** (no Supabase/Inngest/Resend/Vercel
accounts): background jobs run synchronously with the same states and wire shapes (bulk >500
still previews and reports `requires_async_commit`; imports/exports/webhook delivery are
sync best-effort, with webhook retries recorded on the §12 schedule for a future runner);
file storage is a local-disk stand-in behind `src/server/lib/storage.ts` with HMAC-signed
download tokens standing in for signed Storage URLs; imports are CSV-only (no XLSX parser is
carried — the upload error says so and names the Excel export path) and capped at 10k rows so
one change set can hold the commit; email delivery is absent (`notifications.emailed_at` stays
null); Step 16 is a GitHub Actions pipeline (`.github/workflows/ci.yml`) enforcing typecheck,
lint, the full suite against real Postgres 16 with RLS, the §6.1 perf gates, migrations from an
empty database, and the production build — the Vercel/Supabase deploy stages need accounts the
repository does not carry.

**Still open:** the Item Type builder screen (types are created from presets via API/seed today),
XLSX import, drag-to-node assignment from the grid, Playwright E2E + axe in CI, and the §9.2
deploy stages.
