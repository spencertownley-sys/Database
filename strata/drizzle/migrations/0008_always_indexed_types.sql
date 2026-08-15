-- Tech Spec §2.2: select, multi_select, date, datetime, user, and checkbox
-- fields are always-on indexed — they are overwhelmingly what people filter
-- and group by. Flip the flag, then backfill the projection so the
-- "item_field_index is rebuildable from effective_values" invariant holds the
-- moment the flag lands (a flipped flag with no rows would read as drift).
UPDATE "fields" SET "is_indexed" = true
WHERE "type" IN ('select', 'multi_select', 'date', 'datetime', 'user', 'checkbox')
  AND "is_indexed" = false;--> statement-breakpoint

-- Backfill, one storage class at a time. Idempotent: the upsert overwrites.
-- select → value_text (single option id)
INSERT INTO item_field_index (workspace_id, item_id, field_id, item_type_id, value_text)
SELECT i.workspace_id, i.id, f.id, i.item_type_id, i.effective_values ->> f.key
FROM items i
JOIN fields f ON f.item_type_id = i.item_type_id AND f.deleted_at IS NULL AND f.is_indexed
WHERE f.type = 'select'
  AND i.archived_at IS NULL
  AND i.effective_values ? f.key
  AND jsonb_typeof(i.effective_values -> f.key) <> 'null'
ON CONFLICT (item_id, field_id) DO UPDATE SET
  value_text = excluded.value_text, value_number = null, value_date = null,
  value_bool = null, value_uuid = null, value_text_array = null;--> statement-breakpoint

-- multi_select → value_text_array (option id list)
INSERT INTO item_field_index (workspace_id, item_id, field_id, item_type_id, value_text_array)
SELECT i.workspace_id, i.id, f.id, i.item_type_id,
  (SELECT array_agg(x) FROM jsonb_array_elements_text(i.effective_values -> f.key) x)
FROM items i
JOIN fields f ON f.item_type_id = i.item_type_id AND f.deleted_at IS NULL AND f.is_indexed
WHERE f.type = 'multi_select'
  AND i.archived_at IS NULL
  AND i.effective_values ? f.key
  AND jsonb_typeof(i.effective_values -> f.key) = 'array'
ON CONFLICT (item_id, field_id) DO UPDATE SET
  value_text = null, value_number = null, value_date = null,
  value_bool = null, value_uuid = null, value_text_array = excluded.value_text_array;--> statement-breakpoint

-- date / datetime → value_date
INSERT INTO item_field_index (workspace_id, item_id, field_id, item_type_id, value_date)
SELECT i.workspace_id, i.id, f.id, i.item_type_id, (i.effective_values ->> f.key)::timestamptz
FROM items i
JOIN fields f ON f.item_type_id = i.item_type_id AND f.deleted_at IS NULL AND f.is_indexed
WHERE f.type IN ('date', 'datetime')
  AND i.archived_at IS NULL
  AND i.effective_values ? f.key
  AND jsonb_typeof(i.effective_values -> f.key) <> 'null'
ON CONFLICT (item_id, field_id) DO UPDATE SET
  value_text = null, value_number = null, value_date = excluded.value_date,
  value_bool = null, value_uuid = null, value_text_array = null;--> statement-breakpoint

-- checkbox → value_bool
INSERT INTO item_field_index (workspace_id, item_id, field_id, item_type_id, value_bool)
SELECT i.workspace_id, i.id, f.id, i.item_type_id, (i.effective_values -> f.key)::text::boolean
FROM items i
JOIN fields f ON f.item_type_id = i.item_type_id AND f.deleted_at IS NULL AND f.is_indexed
WHERE f.type = 'checkbox'
  AND i.archived_at IS NULL
  AND i.effective_values ? f.key
  AND jsonb_typeof(i.effective_values -> f.key) = 'boolean'
ON CONFLICT (item_id, field_id) DO UPDATE SET
  value_text = null, value_number = null, value_date = null,
  value_bool = excluded.value_bool, value_uuid = null, value_text_array = null;--> statement-breakpoint

-- user (single) → value_uuid
INSERT INTO item_field_index (workspace_id, item_id, field_id, item_type_id, value_uuid)
SELECT i.workspace_id, i.id, f.id, i.item_type_id, (i.effective_values ->> f.key)::uuid
FROM items i
JOIN fields f ON f.item_type_id = i.item_type_id AND f.deleted_at IS NULL AND f.is_indexed
WHERE f.type = 'user'
  AND COALESCE((f.config ->> 'multiple')::boolean, false) = false
  AND i.archived_at IS NULL
  AND i.effective_values ? f.key
  AND jsonb_typeof(i.effective_values -> f.key) = 'string'
ON CONFLICT (item_id, field_id) DO UPDATE SET
  value_text = null, value_number = null, value_date = null,
  value_bool = null, value_uuid = excluded.value_uuid, value_text_array = null;--> statement-breakpoint

-- user (multiple) → value_text_array
INSERT INTO item_field_index (workspace_id, item_id, field_id, item_type_id, value_text_array)
SELECT i.workspace_id, i.id, f.id, i.item_type_id,
  (SELECT array_agg(x) FROM jsonb_array_elements_text(i.effective_values -> f.key) x)
FROM items i
JOIN fields f ON f.item_type_id = i.item_type_id AND f.deleted_at IS NULL AND f.is_indexed
WHERE f.type = 'user'
  AND COALESCE((f.config ->> 'multiple')::boolean, false) = true
  AND i.archived_at IS NULL
  AND i.effective_values ? f.key
  AND jsonb_typeof(i.effective_values -> f.key) = 'array'
ON CONFLICT (item_id, field_id) DO UPDATE SET
  value_text = null, value_number = null, value_date = null,
  value_bool = null, value_uuid = null, value_text_array = excluded.value_text_array;
