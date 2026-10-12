# Strata — API Design

**Version:** 1.0
**Date:** August 15, 2026
**Companion to:** `strata-TECH_SPEC.md` (§2 data model, §3 auth)

---

## 1. Overview

| | |
|---|---|
| **Style** | REST over JSON |
| **Base URL** | `https://app.strata.app/api/v1` |
| **Auth** | Session cookie (browser) or `Authorization: Bearer sk_live_...` (API key) |
| **Content type** | `application/json; charset=utf-8` |
| **Versioning** | URL prefix `/v1`. Breaking changes ship as `/v2` with 12 months of `/v1` support. Additive changes (new fields, new optional params) ship in place. |
| **Pagination** | Cursor-based (`cursor` + `limit`). Offset pagination is not offered — it does not hold at scale. |
| **Idempotency** | `Idempotency-Key` header honored on all `POST` requests, 24h window. |
| **Time** | RFC 3339 UTC, e.g. `2026-08-15T14:30:00Z`. |
| **IDs** | UUID v7 as strings. |
| **Spec** | OpenAPI 3.1 generated from the Zod schemas, served at `/api/openapi`. Contract tests fail the build on drift. |

**This is the same API the Strata web app uses.** There is no private second API. Every screen in the product is built on these endpoints, which is the only reliable way to keep a public API honest.

### 1.0 Unauthenticated endpoints

Two, and only two:

- **`GET /api/health`** — uptime probe. Outside `/v1`, no auth, no workspace context. Returns `{ "status": "ok", "db": "ok", "redis": "ok", "version": "..." }` with 200, or 503 with the failing dependency named. It reports dependency reachability only and never touches tenant data.
- **`GET /share/:token`** — the read-only shared view page (not a JSON API; it is a server-rendered route). Read-only by design: an anonymous request has no member row, so there is nothing to scope write permissions against.

Everything else requires credentials.

### 1.1 Workspace scoping

Every request resolves to exactly one workspace:

- **API key:** the key is bound to a workspace at creation. No header needed.
- **Session:** `X-Workspace-Id: <uuid>` header, validated against the caller's memberships. Requests without it are rejected with `WORKSPACE_REQUIRED` — there is no "default workspace" fallback, because an implicit tenant is how cross-tenant bugs happen.

### 1.2 Conventions

- Collection responses: `{ "data": [...], "meta": { "cursor": "...", "has_more": bool, "total": int|null } }`. `total` is `null` on filtered queries over 10,000 rows, where an exact count is not worth the scan.
- Single-resource responses return the object at the top level.
- `PATCH` is partial; only supplied fields change. `PUT` is not used.
- Custom field values live under `values` (own) and `effective_values` (resolved, read-only), keyed by field `key`.
- Expansion via `?expand=item_type,parent,tree_nodes` — comma-separated, max 3 levels.
- Field selection via `?fields=title,status,due_date` — reduces payload for grid loads.

---

## 2. Authentication

Browser auth is handled by Supabase Auth, not by these endpoints. The routes below exist for programmatic clients and for the app's own session bootstrap.

### POST /auth/signup

**Request:**
```json
{ "email": "dana@agency.com", "password": "...", "name": "Dana Reyes" }
```

**Response 201:**
```json
{
  "user": { "id": "018f...", "email": "dana@agency.com", "name": "Dana Reyes" },
  "workspace": { "id": "018f...", "slug": "danas-workspace", "name": "Dana's Workspace" },
  "session": { "access_token": "...", "refresh_token": "...", "expires_at": "2026-08-15T15:30:00Z" }
}
```

A workspace is always created on signup, seeded with the built-in tree and the Task Item Type, so a new user is never in a zero state with nothing to click.

**Errors:** 400 `VALIDATION_ERROR`, 409 `CONFLICT` (email in use), 429 `RATE_LIMITED`

---

### POST /auth/login

**Request:** `{ "email": "...", "password": "..." }`
**Response 200:** `{ "user": {...}, "workspaces": [...], "session": {...} }`
**Errors:** 400, 401 `UNAUTHORIZED`, 429

---

### POST /auth/logout

Requires auth. No body. **Response 204.**

---

### GET /auth/me

**Response 200:**
```json
{
  "user": { "id": "018f...", "email": "dana@agency.com", "name": "Dana Reyes", "avatar_url": null },
  "workspaces": [
    { "id": "018f...", "slug": "acme-agency", "name": "Acme Agency", "role": "admin" }
  ]
}
```

---

## 3. Item Types & Fields

### GET /item-types

**Query params:**

| Param | Type | Description |
|---|---|---|
| `include_archived` | bool | Default `false` |
| `expand` | string | `fields`, `field_groups` |

**Response 200:**
```json
{
  "data": [
    {
      "id": "018f2a...",
      "key": "client_project",
      "label": "Client Projects",
      "description": "Work we deliver for retainer clients",
      "icon": "folder",
      "color": "#4F46E5",
      "variant_axes": [],
      "item_count": 1247,
      "field_count": 12,
      "created_at": "2026-07-01T09:00:00Z",
      "updated_at": "2026-08-10T14:22:00Z"
    }
  ],
  "meta": { "cursor": null, "has_more": false, "total": 4 }
}
```

---

### POST /item-types

Requires `admin`. Creates a type, optionally from a preset.

**Request:**
```json
{
  "label": "Campaigns",
  "key": "campaign",
  "icon": "megaphone",
  "color": "#F59E0B",
  "preset": "campaign",
  "fields": [
    { "key": "title",  "label": "Title",  "type": "text",   "required_for_completeness": true },
    { "key": "region", "label": "Region", "type": "select",
      "config": { "options": [
        { "id": "emea", "label": "EMEA", "color": "#0EA5E9" },
        { "id": "apac", "label": "APAC", "color": "#10B981" }
      ]}},
    { "key": "tagline", "label": "Tagline", "type": "text", "inheritance": "shared" },
    { "key": "budget", "label": "Budget", "type": "currency",
      "config": { "currency_code": "GBP", "precision": 2 },
      "inheritance": "variant" }
  ],
  "variant_axes": [{ "field_key": "region", "label": "Region" }]
}
```

`key` is optional — slugified from `label` when omitted. Supplying `preset` without `fields` creates the preset's default field set.

**Response 201:** the full item type with `fields` expanded.

**Errors:** 400 `VALIDATION_ERROR`, 403 `FORBIDDEN`, 409 `CONFLICT` (key exists), 422 `INVALID_VARIANT_AXIS` (axis field is not a `select`, or is not in the field list)

---

### GET /item-types/:id · PATCH /item-types/:id · DELETE /item-types/:id

`PATCH` accepts `label`, `description`, `icon`, `color`, `variant_axes`, `archived_at`. **`key` is immutable.**

`DELETE` requires `admin` and `?confirm=<key>` when the type has items; without it, 409 `TYPE_IN_USE` with the item count in `details`.

**Responses:** 200 / 204 / 403 / 404 / 409

---

### POST /item-types/:id/fields

**Request:**
```json
{
  "key": "brief_url",
  "label": "Brief URL",
  "type": "url",
  "field_group_id": "018f...",
  "position": 6,
  "required_for_completeness": true,
  "inheritance": "variant",
  "is_indexed": false,
  "default_value": null,
  "acknowledge_incomplete": true
}
```

`acknowledge_incomplete` is **required** when adding a `required_for_completeness` field to a type with existing items and no `default_value`. Without it, 409 `REQUIRES_ACKNOWLEDGMENT` with `details.affected_items`. This exists so nobody silently drops a workspace's average completeness overnight.

**Response 201:** the field, plus `meta.backfill_job_id` when `is_indexed` triggers a projection backfill.

---

### PATCH /fields/:id

Accepts `label`, `position`, `field_group_id`, `config`, `required_for_completeness`, `inheritance`, `is_indexed`, `is_searchable`, and `type`.

**Changing `type` requires a two-step flow.** First, preview:

`POST /fields/:id/type-change-preview` → `{ "type": "number" }`

```json
{
  "clean": 412,
  "coerced": 18,
  "preserved_as_text": 3,
  "samples": [
    { "item_id": "018f...", "before": "40,000", "after": 40000,  "status": "coerced" },
    { "item_id": "018f...", "before": "TBD",    "after": null,   "status": "preserved_as_text" }
  ]
}
```

Then `PATCH /fields/:id` with `{ "type": "number", "confirm_conversion": true }`. Without the flag, 409 `CONVERSION_REQUIRES_CONFIRMATION`.

---

### DELETE /fields/:id

Soft delete, 30-day retention. **Response 200:**
```json
{ "id": "018f...", "deleted_at": "2026-08-15T14:30:00Z", "restorable_until": "2026-09-14T14:30:00Z" }
```

`POST /fields/:id/restore` restores it with values intact.

---

### Field Groups

`GET /item-types/:id/field-groups` · `POST /item-types/:id/field-groups` · `PATCH /field-groups/:id` · `DELETE /field-groups/:id`

Deleting a group moves its fields to ungrouped; it never deletes fields.

---

## 4. Items

### GET /items

The most-used endpoint in the product. It backs every grid, list, and board load.

**Query params:**

| Param | Type | Description |
|---|---|---|
| `item_type_id` | uuid | Required unless `view_id` is given |
| `view_id` | uuid | Applies a saved view's filters, sort, and visible fields |
| `filter` | string | URL-encoded JSON `FilterGroup` (§4.1). Merges with `view_id` filters via AND |
| `sort` | string | `field_key:asc,other_key:desc`. Max 3 keys |
| `fields` | string | Comma-separated field keys to return. Omit for all |
| `cursor` | string | Opaque keyset cursor |
| `limit` | int | Default 100, max 500 |
| `parent_id` | uuid | Direct children only |
| `in_subtree` | uuid | Item and all work-hierarchy descendants |
| `tree_node_id` | uuid | Members of a category tree node |
| `include_descendants` | bool | With `tree_node_id`, includes descendant nodes. Default `true` |
| `variant_parent_id` | uuid | Variants of a model |
| `include_variants` | bool | Default `true`. `false` returns models and standalone items only |
| `q` | string | Trigram text search over title + searchable fields |
| `expand` | string | `item_type`, `parent`, `tree_nodes`, `variant_parent` |

**Response 200:**
```json
{
  "data": [
    {
      "id": "018f3b...",
      "item_type_id": "018f2a...",
      "title": "Acme Q3 Rebrand",
      "parent_id": null,
      "depth": 0,
      "position": 1024,
      "variant_parent_id": null,
      "is_variant_model": false,
      "values":           { "client": "018f...", "status": "active", "budget": 40000 },
      "effective_values": { "client": "018f...", "status": "active", "budget": 40000 },
      "invalid_values":   { "due_date": { "raw": "next Q", "message": "Expected a date — got 'next Q'" } },
      "completeness_pct": 78,
      "missing_required": ["budget", "brief_url"],
      "tree_node_ids": ["018f...", "018f..."],
      "created_by": "018f...",
      "created_at": "2026-07-01T09:00:00Z",
      "updated_at": "2026-08-14T11:02:00Z"
    }
  ],
  "meta": { "cursor": "eyJzIjoiMjAyNi0wOC0xNCIsImkiOiIwMThmIn0", "has_more": true, "total": 1247 }
}
```

**Notes.** `effective_values` is what you should read — for a non-variant it equals `values`; for a variant it is the resolved merge. `values` is what you write. `invalid_values` holds flagged drafts that failed coercion; the rest of the item saved anyway (Tech Spec §7.1).

**Errors:** 400 `VALIDATION_ERROR`, 400 `FIELD_NOT_FILTERABLE`, 401, 403, 422 `FILTER_TOO_COMPLEX`

---

### 4.1 Filter grammar

```json
{
  "op": "and",
  "children": [
    { "field": "status",       "operator": "in",         "value": ["active", "blocked"] },
    { "field": "completeness", "operator": "lt",         "value": 100 },
    { "field": "due_date",     "operator": "between",    "value": ["2026-08-01", "2026-09-30"] },
    { "field": "tree",         "operator": "in_subtree", "value": "018f-node-uuid" },
    {
      "op": "or",
      "children": [
        { "field": "owner",  "operator": "eq",        "value": "018f-user-uuid" },
        { "field": "budget", "operator": "is_empty",  "value": null }
      ]
    }
  ]
}
```

**Operators:** `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `contains`, `starts_with`, `in`, `not_in`, `is_empty`, `is_not_empty`, `between`, `in_subtree`

**Built-in pseudo-fields:** `title`, `completeness`, `tree`, `depth`, `parent`, `item_type`, `created_at`, `updated_at`, `created_by`

**Limits:** 20 clauses, nesting depth 4. Beyond either, 422 `FILTER_TOO_COMPLEX`.

**A clause on a non-indexed field returns 400** rather than silently running a slow scan:

```json
{
  "error": {
    "code": "FIELD_NOT_FILTERABLE",
    "message": "Field 'notes' is not indexed for filtering.",
    "details": { "field_key": "notes", "action": "PATCH /fields/018f... with is_indexed: true" }
  }
}
```

---

### GET /items/:id

**Query:** `expand=item_type,parent,children,tree_nodes,variant_parent,variants,activity`

**Response 200:** the item, plus for a variant:

```json
{
  "variant_info": {
    "variant_parent_id": "018f...",
    "variant_parent_title": "Q3 Launch Campaign",
    "axis_values": { "region": "emea" },
    "inherited_fields": ["tagline", "objective", "creative_brief",
                         "approval_contact", "kpi_target", "channel"],
    "overridden_fields": ["budget", "launch_date"],
    "propagating": false
  }
}
```

---

### POST /items

Creates a single item. Internally this is a change set with `item_count = 1`, auto-committed — the change set id is returned so the client can offer undo.

**Request:**
```json
{
  "item_type_id": "018f2a...",
  "title": "Initech Campaign",
  "parent_id": "018f3b...",
  "values": { "client": "018f...", "status": "draft", "budget": 25000 },
  "tree_node_ids": ["018f..."]
}
```

**Response 201:** the created item, with `meta.change_set_id`.

**Errors:** 400, 403, 404 (`item_type_id` or `parent_id` not found), 409 `HIERARCHY_CYCLE`, 422 `VARIANT_CONSTRAINT` (a variant model may not have a parent)

---

### PATCH /items/:id

Partial update. Only keys present in `values` change; a key set to `null` clears that field.

**Request:**
```json
{ "title": "Initech Campaign — Q4", "values": { "status": "active", "budget": null } }
```

**Response 200:** the updated item with recomputed `effective_values`, `completeness_pct`, `missing_required`, and `meta.change_set_id`.

**On a variant**, writing a key into `values` **is** the override. To revert to inherited, send `{ "revert_fields": ["budget"] }` — which deletes the key rather than setting it to null.

**Errors:** 400, 403, 404, 409 `STALE_WRITE` (with `If-Match` supplied and mismatched), 422 `FIELD_READ_ONLY` (writing a `shared` field on a variant)

---

### DELETE /items/:id

Soft delete (archive), 30-day retention. `?cascade=true` required when the item has work-hierarchy children; without it, 409 `HAS_CHILDREN`.

**Response 200:** `{ "id": "...", "archived_at": "...", "change_set_id": "...", "cascaded_count": 3 }`

---

### POST /items/:id/recompute

Admin repair path (Tech Spec AD-4). Recomputes `effective_values`, `completeness_pct`, `search_text`, and the projection index for this item and, with `?include_variants=true`, its variants.

**Response 202:** `{ "job_id": "...", "item_count": 15 }`

---

### POST /items/:id/generate-variants

**Request:**
```json
{ "axis_values": { "region": ["emea", "apac", "amer"] }, "preview": true }
```

With `preview: true`, **Response 200** returns the change-set preview of the N variants that would be created. With `preview: false`, **Response 201** creates them.

**Errors:** 422 `VARIANT_LIMIT_EXCEEDED` (200 per model), 422 `NOT_VARIANT_ENABLED` (the item type declares no `variant_axes`)

---

## 5. Change Sets

The write path for everything multi-item. See Tech Spec §2.7.

### POST /change-sets

Creates a **preview**. Writes nothing to items.

**Request:**
```json
{
  "operation": "set_field",
  "target": {
    "item_type_id": "018f2a...",
    "item_ids": ["018f...", "018f..."],
    "filter": null
  },
  "patch": { "values": { "status": "active" } }
}
```

`target` accepts either an explicit `item_ids` array (max 10,000) or a `filter` that resolves server-side — the latter is how "select all 1,247 matching" works without shipping 1,247 IDs.

**Operations — nine:** `create`, `set_field`, `clear_field`, `change_type`, `reparent`, `tree_assign`, `tree_unassign`, `delete`, `assign_user`

A tenth value, `variant_propagate`, appears on change sets in `GET` responses but cannot be created through this endpoint — it is emitted by the system when a shared field on a variant model propagates to its variants.

**Response 201:**
```json
{
  "id": "018f4c...",
  "status": "preview",
  "operation": "set_field",
  "item_count": 142,
  "skipped": [
    { "item_id": "018f...", "reason": "permission" },
    { "item_id": "018f...", "reason": "locked" }
  ],
  "summary": {
    "fields": ["status"],
    "per_field_delta": { "status": { "from": { "draft": 96, "blocked": 46 }, "to": "active" } }
  },
  "samples": [
    { "item_id": "018f...", "title": "Acme Q3 Rebrand", "changes": {
      "status": { "before": "draft", "after": "active" } } }
  ],
  "expires_at": "2026-08-15T15:30:00Z"
}
```

Up to 20 samples. Previews expire after 1 hour.

**Errors:** 400, 403, 422 `TARGET_TOO_LARGE` (> 10,000 items), 422 `OPERATION_NOT_APPLICABLE`

---

### POST /change-sets/:id/commit

**Response 200** (≤ `BULK_SYNC_THRESHOLD`, default 500):
```json
{
  "id": "018f4c...",
  "status": "committed",
  "item_count": 142,
  "committed_at": "2026-08-15T14:31:12Z",
  "undo_available_until": "2026-08-16T14:31:12Z"
}
```

**Response 202** (above the threshold): `{ "id": "...", "status": "committing", "job_id": "...", "item_count": 4812 }` — poll `GET /change-sets/:id` or subscribe to the `change_set.committed` webhook.

**Errors:**
- 409 `STALE_PREVIEW` — one or more items changed since the preview. `details.conflicts` lists item ids and current values. **Never auto-retried**; the client re-previews.
- 410 `PREVIEW_EXPIRED`
- 403, 404, 422 `ALREADY_COMMITTED`

---

### POST /change-sets/:id/undo

Creates and commits the inverse change set.

**Response 200:**
```json
{
  "undo_change_set_id": "018f4d...",
  "original_change_set_id": "018f4c...",
  "status": "committed",
  "item_count": 142,
  "restored": 140,
  "skipped": [{ "item_id": "018f...", "reason": "item deleted since" }]
}
```

Undo is itself a change set and is itself undoable (i.e. redo). Skipped items are always reported — a partial undo must never present as a complete one.

**Errors:** 403 (`member` may only undo their own), 409 `ALREADY_UNDONE`, 410 `UNDO_WINDOW_EXPIRED` (24h), 422 `CANNOT_UNDO_SCHEMA_CHANGE`

---

### GET /change-sets

**Query:** `item_id`, `actor_id`, `operation`, `source`, `status`, `since`, `until`, `cursor`, `limit`

Backs both the workspace activity feed and the per-item history.

**Response 200:**
```json
{
  "data": [
    {
      "id": "018f4c...",
      "actor": { "id": "018f...", "name": "Dana Reyes" },
      "source": "ui_bulk",
      "operation": "set_field",
      "status": "committed",
      "item_count": 142,
      "summary": { "fields": ["status"] },
      "committed_at": "2026-08-15T14:31:12Z",
      "undone_by_id": null
    }
  ],
  "meta": { "cursor": "...", "has_more": true, "total": null }
}
```

---

### GET /change-sets/:id/entries

Per-item, per-field before/after. Paginated — a 10,000-item change set has a lot of entries.

**Response 200:**
```json
{
  "data": [
    { "item_id": "018f...", "field_key": "status", "before": "draft", "after": "active" }
  ],
  "meta": { "cursor": "...", "has_more": true, "total": 142 }
}
```

---

## 6. Trees

### GET /trees
**Response 200:** `{ "data": [{ "id": "...", "key": "client", "label": "Clients", "is_builtin": false, "node_count": 42 }] }`

### POST /trees
Requires `admin`. **Response 201.** **Errors:** 403, 409 `TREE_LIMIT_REACHED` (v1: built-in + 1 custom)

### GET /trees/:id/nodes
**Query:** `parent_id` (direct children), `depth` (max levels), `include_counts` (default `true`)

**Response 200:**
```json
{
  "data": [
    { "id": "018f...", "parent_id": null, "label": "Acme", "path": "018f_a",
      "position": 1024, "item_count": 87, "descendant_item_count": 214, "child_count": 3 }
  ]
}
```

### POST /trees/:id/nodes · PATCH /tree-nodes/:id · DELETE /tree-nodes/:id

`PATCH` accepts `label`, `parent_id` (reparent — rewrites the subtree path), `position`.

`DELETE` requires an explicit disposition when the node has members:

```
DELETE /tree-nodes/:id?on_members=unassign
DELETE /tree-nodes/:id?on_members=move_to_parent
DELETE /tree-nodes/:id?on_members=move_to&target_node_id=018f...
```

Without it, 409 `NODE_HAS_MEMBERS` with the count. Items are never silently orphaned.

### POST /tree-nodes/:id/items · DELETE /tree-nodes/:id/items

Bulk assign/unassign. `{ "item_ids": [...] }` or `{ "filter": {...} }`. Above 1 item this routes through a change set and **Response 201** returns the preview; add `"auto_commit": true` to skip it.

---

## 7. Views

### GET /views · POST /views · GET /views/:id · PATCH /views/:id · DELETE /views/:id

**POST request:**
```json
{
  "item_type_id": "018f2a...",
  "name": "Incomplete — Acme",
  "type": "grid",
  "visibility": "workspace",
  "config": {
    "filters": { "op": "and", "children": [
      { "field": "completeness", "operator": "lt", "value": 100 },
      { "field": "tree", "operator": "in_subtree", "value": "018f-acme" }
    ]},
    "sort": [{ "field_key": "due_date", "dir": "asc" }],
    "visible_fields": ["title", "client", "status", "owner", "due_date"],
    "group_by": "status",
    "column_widths": { "title": 320, "client": 160 },
    "column_order": ["title", "client", "status", "owner", "due_date"],
    "row_height": "short"
  }
}
```

**Response 201.** `visibility: "shared"` additionally returns `share_token` and `share_url`.

> ⚠️ `visible_fields` is a **display** control, not an access control. A view shared externally does not prevent a determined viewer from learning about hidden fields. Guests have no API access in v1 for exactly this reason. See Tech Spec §7.6.

### GET /views/:id/items
Convenience wrapper for `GET /items?view_id=:id`. Same response shape.

---

## 8. Import & Export

### POST /imports
Initiates an import. **Request** is `multipart/form-data`: `file` (CSV/XLSX, ≤ 50MB), `item_type_id`, optional `import_profile_id`.

**Response 201:**
```json
{
  "id": "018f5e...",
  "status": "mapping",
  "file_name": "projects_q3.xlsx",
  "row_count": 4812,
  "detected_columns": [
    { "index": 0, "name": "Project Name", "samples": ["Acme Q3 Rebrand", "Globex Site Build"],
      "suggested_field_key": "title", "confidence": 0.94 },
    { "index": 2, "name": "Lead", "samples": ["dana@agency.com"],
      "suggested_field_key": "owner", "confidence": 0.61 }
  ]
}
```

### PATCH /imports/:id/mapping
```json
{
  "mapping": {
    "columns": [
      { "source": "Project Name", "field_key": "title" },
      { "source": "Value", "field_key": "budget", "transform": "strip_currency" }
    ],
    "match_key": "title"
  },
  "save_as_profile": "Monthly client projects"
}
```
**Response 200:** the job with `status: "validating"` and a `job_id`.

### GET /imports/:id
**Response 200** once validated:
```json
{
  "id": "018f5e...",
  "status": "ready",
  "row_count": 4812,
  "valid_count": 4798,
  "error_count": 14,
  "will_create": 4780,
  "will_update": 18,
  "warnings": [
    { "column": "Value", "message": "14 values could not be read as currency",
      "sample_rows": [412, 908, 1122] }
  ],
  "error_file_url": "https://.../errors.csv?signature=..."
}
```

### POST /imports/:id/commit
**Response 202:** `{ "id": "...", "status": "committing", "change_set_id": "018f...", "job_id": "..." }`

The `change_set_id` makes the entire import undoable through `POST /change-sets/:id/undo`.

### Import Profiles
`GET /import-profiles` · `POST /import-profiles` · `DELETE /import-profiles/:id`

### POST /exports
```json
{ "view_id": "018f...", "format": "xlsx", "include_hidden_fields": false }
```

**Response 200** (≤ 5,000 rows — generated synchronously):
```json
{ "status": "ready", "row_count": 1247, "download_url": "...", "expires_at": "..." }
```

**Response 202** (> 5,000 rows — queued):
```json
{ "job_id": "...", "status": "queued", "estimated_rows": 42000 }
```

`GET /exports/:job_id` → `{ "status": "ready", "download_url": "...", "expires_at": "..." }` (signed URL, 1h). Poll it, or subscribe to the notification.

All text values are escaped against CSV injection on generation (Tech Spec §7.2).

---

## 9. Workspaces, Members, Notifications, Keys, Webhooks

### GET /workspaces · POST /workspaces · GET /workspaces/:id · PATCH /workspaces/:id · DELETE /workspaces/:id

`GET /workspaces` lists the caller's memberships (no `X-Workspace-Id` required — this is the one endpoint that spans workspaces).

**GET /workspaces/:id response 200:**
```json
{
  "id": "018f...", "slug": "acme-agency", "name": "Acme Agency", "plan": "free",
  "settings": { "feature_flags": { "variants": true, "async_bulk": true, "import_commit": true } },
  "role": "admin",
  "counts": { "members": 12, "item_types": 4, "items": 1247, "trees": 2 }
}
```

`PATCH` accepts `name`, `slug`, `settings`. Owner only. `DELETE` requires `?confirm=<slug>` and an emailed confirmation; it cascades and purges Storage within 30 days.

---

### POST /workspaces/:id/data-export

GDPR "export my data." Queues a full workspace export — all item types, fields, items, trees, change history, and members — as a JSONL bundle.

**Response 202:** `{ "job_id": "...", "status": "queued" }`
`GET /exports/:job_id` returns the signed download URL when ready. Owner or admin only.

---

### GET /notifications

**Query:** `unread_only` (bool), `type`, `cursor`, `limit`

**Response 200:**
```json
{
  "data": [
    { "id": "018f...", "type": "assigned", "read_at": null,
      "payload": { "item_id": "018f...", "item_title": "Logo refresh", "actor_id": "018f..." },
      "created_at": "2026-08-15T14:31:12Z" }
  ],
  "meta": { "cursor": "...", "has_more": false, "total": 3 }
}
```

**Types:** `assigned`, `invited`, `export_ready`, `import_done`. (`mentioned` arrives with comments in Phase 2.)

### POST /notifications/read

`{ "ids": ["018f..."] }` or `{ "all": true }`. **Response 200:** `{ "marked_read": 3 }`

### GET /notification-preferences · PATCH /notification-preferences

`{ "email": { "assigned": true, "invited": true, "export_ready": false }, "digest": "daily" }` — `digest` is `off` | `daily` | `weekly`.

---

### GET /members · POST /members/invite · PATCH /members/:id · DELETE /members/:id

**Invite request:**
```json
{
  "email": "client@acme.com",
  "role": "guest",
  "guest_scopes": [{ "tree_node_id": "018f-acme", "include_descendants": true }]
}
```
**Response 201:** the pending member. `guest_scopes` is required when `role` is `guest` — a guest with no scope would see nothing, which is confusing rather than safe.

### GET /api-keys · POST /api-keys · DELETE /api-keys/:id

**POST response 201** — the only time the plaintext key is ever returned:
```json
{
  "id": "018f...",
  "name": "Reporting pipeline",
  "key": "sk_live_a1b2c3d4e5f6...",
  "key_prefix": "sk_live_a1b2",
  "scopes": ["items:read", "schema:read"],
  "expires_at": null
}
```

**Scopes:** `items:read`, `items:write`, `schema:read`, `schema:write`, `trees:read`, `trees:write`, `views:read`, `views:write`, `imports:write`, `exports:write`, `webhooks:manage`

**A key cannot be created by, or scoped to, a `guest` member.** 403 `GUEST_API_FORBIDDEN`.

### GET /webhooks · POST /webhooks · PATCH /webhooks/:id · DELETE /webhooks/:id · POST /webhooks/:id/test

**POST request:**
```json
{
  "url": "https://hooks.example.com/strata",
  "events": ["item.created", "item.updated", "change_set.committed"]
}
```
**Response 201** returns `secret` once.

---

## 10. Error Format

Every error, from every endpoint:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable, specific, and actionable.",
    "details": {
      "fields": [
        { "field": "values.budget", "message": "Expected a number — got 'TBD'" }
      ]
    },
    "request_id": "req_018f4c9a..."
  }
}
```

`details` is always an **object**, never an array — different codes populate different keys (`details.fields`, `details.conflicts`, `details.field_key`, `details.action`, `details.affected_items`, `details.required_role`). Clients read the key their code documents and ignore the rest.

`request_id` appears in every response header as `X-Request-Id` and in Sentry, so a user-reported error maps to a trace in one lookup.

### Standard codes

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Malformed or invalid input |
| 400 | `FIELD_NOT_FILTERABLE` | Filter on a non-indexed field; `details.action` says how to fix |
| 400 | `WORKSPACE_REQUIRED` | Session request missing `X-Workspace-Id` |
| 401 | `UNAUTHORIZED` | Missing or invalid credentials |
| 403 | `FORBIDDEN` | Authenticated, not permitted; `details.required_role` |
| 403 | `GUEST_API_FORBIDDEN` | Guests cannot use the API in v1 |
| 404 | `NOT_FOUND` | Absent, or outside the caller's workspace (deliberately indistinguishable) |
| 409 | `CONFLICT` | Duplicate key |
| 409 | `STALE_PREVIEW` | Items changed since preview; `details.conflicts` |
| 409 | `STALE_WRITE` | `If-Match` version mismatch |
| 409 | `HIERARCHY_CYCLE` | Reparent would create a cycle |
| 409 | `HAS_CHILDREN` | Delete needs `?cascade=true` |
| 409 | `NODE_HAS_MEMBERS` | Node delete needs an `on_members` disposition |
| 409 | `TYPE_IN_USE` | Item type delete needs `?confirm=<key>` |
| 409 | `REQUIRES_ACKNOWLEDGMENT` | Required field on an in-use type |
| 409 | `TREE_LIMIT_REACHED` | v1 caps custom trees at 1 |
| 409 | `CONVERSION_REQUIRES_CONFIRMATION` | Field type change without `confirm_conversion` |
| 409 | `ALREADY_UNDONE` | Change set was already undone |
| 410 | `PREVIEW_EXPIRED` / `UNDO_WINDOW_EXPIRED` | Time-boxed action lapsed |
| 422 | `FILTER_TOO_COMPLEX` | > 20 clauses or depth > 4 |
| 422 | `TARGET_TOO_LARGE` | > 10,000 items in one change set |
| 422 | `OPERATION_NOT_APPLICABLE` | Operation invalid for the targeted items |
| 422 | `ALREADY_COMMITTED` | Change set is not in `preview` status |
| 422 | `CANNOT_UNDO_SCHEMA_CHANGE` | Schema mutations are not change sets and cannot be undone |
| 422 | `VARIANT_CONSTRAINT` | Violates the v1 variant/hierarchy rules |
| 422 | `VARIANT_LIMIT_EXCEEDED` | > 200 variants per model |
| 422 | `NOT_VARIANT_ENABLED` | Item type declares no `variant_axes` |
| 422 | `INVALID_VARIANT_AXIS` | Axis field is absent or not a `select` |
| 422 | `FIELD_READ_ONLY` | Writing a `shared` field on a variant |
| 429 | `RATE_LIMITED` | See §11 |
| 500 | `INTERNAL_ERROR` | Server fault; `request_id` is the handle |
| 503 | `SERVICE_UNAVAILABLE` | Dependency down; `Retry-After` set |

**404 vs 403 on cross-tenant access:** a resource in another workspace returns 404, never 403. A 403 would confirm the resource exists.

---

## 11. Rate Limiting

| Scope | Limit |
|---|---|
| Auth endpoints | 10 / 15 min per IP **and** per email |
| Session reads | 300 / min per user |
| Session writes | 120 / min per user |
| API key reads | 600 / min per key |
| API key writes | 120 / min per key |
| `POST /change-sets` | 20 / min per actor |
| `POST /imports` | 10 / hour per workspace |
| `POST /exports` | 20 / hour per workspace |

**Headers on every response:** `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (unix seconds). On 429, `Retry-After` in seconds.

Limits **fail open** when Redis is unreachable (Tech Spec §7.3) — a limiter that takes the product down when its cache blips is the worse failure.

---

## 12. Webhooks

### Events

| Event | Fires when |
|---|---|
| `item.created` | An item is created |
| `item.updated` | Any field, hierarchy, or tree membership changes |
| `item.deleted` | An item is archived |
| `item.completed` | Completeness reaches 100% (transition only, not every save) |
| `change_set.committed` | A change set commits — the one to subscribe to for bulk work |
| `change_set.undone` | A change set is undone |
| `item_type.updated` | Schema change — consumers should re-read field definitions |
| `import.completed` | An import commits |
| `member.joined` | An invite is accepted |

### Payload

```json
{
  "id": "evt_018f...",
  "event": "item.updated",
  "workspace_id": "018f...",
  "timestamp": "2026-08-15T14:31:12Z",
  "data": {
    "item": { "id": "018f...", "title": "Acme Q3 Rebrand", "item_type_id": "018f...",
              "effective_values": { "...": "..." }, "completeness_pct": 100 },
    "changes": { "status": { "before": "active", "after": "done" } },
    "change_set_id": "018f...",
    "actor_id": "018f..."
  }
}
```

### Signature verification

```
X-Strata-Signature: v1,t=1755267072,s=5257a869e7b...
```

Signed value is `{timestamp}.{raw_body}`, HMAC-SHA256 with the endpoint secret, hex-encoded. Verify with a constant-time compare and reject timestamps older than 5 minutes.

```js
const signed = `${t}.${rawBody}`
const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex')
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(s))
```

### Delivery

- Expect a 2xx within 10 seconds.
- Retries at 1m, 5m, 30m, 2h, 12h (5 attempts) with jitter.
- 20 consecutive failures auto-disables the endpoint and emails workspace admins.
- **At-least-once delivery** — dedupe on `id`. Bulk change sets emit one `change_set.committed` rather than N `item.updated` events, so a 10,000-item bulk edit does not become 10,000 webhooks.
- `GET /webhooks/:id/deliveries` returns recent attempts with status codes for debugging.

---

## 13. API Design Notes

**Why cursor pagination only.** `OFFSET 50000` scans 50,000 rows. Every list endpoint here is expected to run over 100k-row tables, and offset pagination would breach the §6.1 budgets at exactly the customer size that matters most.

**Why change sets are a resource rather than a flag.** `POST /items/bulk?preview=true` would be simpler, but the preview needs an identity — the client shows it, the user thinks, then commits. That state has to live somewhere addressable. Making it a resource also gives undo and audit history the same identity for free.

**Why `values` and `effective_values` are separate.** A variant's inherited values are not its own. Collapsing them into one field means a client cannot tell inherited from overridden, and a naive round-trip (`GET` then `PATCH` the whole object) would silently convert every inherited value into an override. Two fields make the distinction impossible to lose.

**Why `FIELD_NOT_FILTERABLE` is an error rather than a slow success.** A filter that quietly takes eight seconds trains users to distrust the product. An error with a one-click fix is a better experience than a slow success, and it keeps the performance budget enforceable.

**Why guests have no API access.** Field-level permissions are not a security boundary in v1 (Tech Spec §7.6). Denying guests programmatic access is what keeps that gap from becoming a data leak. This restriction lifts in Phase 2 when real field ACLs ship.
