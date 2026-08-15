-- Data-model alignment with Tech Spec §2 (docs/SPEC_RECONCILIATION.md §3).
-- Hand-written as RENAMEs so existing data survives; the drizzle-generated
-- add/drop pairs would have emptied every renamed column.
CREATE EXTENSION IF NOT EXISTS citext;--> statement-breakpoint

-- Constraints that reference renamed columns come off first.
ALTER TABLE "items" DROP CONSTRAINT "items_variant_model_is_root";--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_variant_not_in_hierarchy";--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_variant_of_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "items" DROP CONSTRAINT "items_parent_id_items_id_fk";--> statement-breakpoint
ALTER TABLE "tree_nodes" DROP CONSTRAINT "tree_nodes_parent_id_tree_nodes_id_fk";--> statement-breakpoint

-- Column renames (Tech Spec §2.2, §2.3, §2.6, §2.8).
ALTER TABLE "items" RENAME COLUMN "variant_of_id" TO "variant_parent_id";--> statement-breakpoint
ALTER TABLE "items" RENAME COLUMN "order_key" TO "position";--> statement-breakpoint
ALTER TABLE "items" RENAME COLUMN "deleted_at" TO "archived_at";--> statement-breakpoint
ALTER TABLE "item_types" RENAME COLUMN "name" TO "label";--> statement-breakpoint
ALTER TABLE "item_types" RENAME COLUMN "plural_name" TO "plural_label";--> statement-breakpoint
ALTER TABLE "item_types" RENAME COLUMN "preset_key" TO "preset_source";--> statement-breakpoint
ALTER TABLE "item_types" RENAME COLUMN "deleted_at" TO "archived_at";--> statement-breakpoint
ALTER TABLE "fields" RENAME COLUMN "order_key" TO "position";--> statement-breakpoint
ALTER TABLE "field_groups" RENAME COLUMN "order_key" TO "position";--> statement-breakpoint
ALTER TABLE "trees" RENAME COLUMN "name" TO "label";--> statement-breakpoint
ALTER TABLE "tree_nodes" RENAME COLUMN "name" TO "label";--> statement-breakpoint
ALTER TABLE "tree_nodes" RENAME COLUMN "order_key" TO "position";--> statement-breakpoint
ALTER TABLE "views" RENAME COLUMN "kind" TO "type";--> statement-breakpoint

-- Role rename: editor → member (Tech Spec §3.1). RENAME VALUE keeps every
-- dependent object — notably the SECURITY DEFINER key-lookup function from
-- 0004 — intact, and rewrites stored rows in place.
ALTER TYPE "public"."member_role" RENAME VALUE 'editor' TO 'member';--> statement-breakpoint
ALTER TABLE "workspace_members" ALTER COLUMN "role" SET DEFAULT 'member'::"public"."member_role";--> statement-breakpoint

-- users.email becomes citext (Tech Spec §2.1): uniqueness is case-insensitive
-- by type, so the lower() expression index retires.
DROP INDEX "users_email_key";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" SET DATA TYPE citext;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree ("email");--> statement-breakpoint

-- change_entries gets the §2.7 bigserial key. Nothing references the old uuid
-- ids; (change_set_id, seq) carries the ordering.
ALTER TABLE "change_entries" DROP CONSTRAINT "change_entries_pkey";--> statement-breakpoint
ALTER TABLE "change_entries" DROP COLUMN "id";--> statement-breakpoint
ALTER TABLE "change_entries" ADD COLUMN "id" bigserial PRIMARY KEY;--> statement-breakpoint

-- items.depth: denormalised nlevel(path) - 1, backfilled from path.
ALTER TABLE "items" ADD COLUMN "depth" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "items" SET "depth" = nlevel("path") - 1;--> statement-breakpoint

-- trees.position (§2.6).
ALTER TABLE "trees" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint

-- API key scopes move to the §9 granular vocabulary.
ALTER TABLE "api_keys" ALTER COLUMN "scopes" SET DEFAULT '{items:read}'::text[];--> statement-breakpoint
UPDATE "api_keys" SET "scopes" = ARRAY['items:read','items:write','schema:read','trees:read','views:read'] WHERE "scopes" && ARRAY['write','admin'];--> statement-breakpoint
UPDATE "api_keys" SET "scopes" = ARRAY['items:read','schema:read','trees:read','views:read'] WHERE "scopes" && ARRAY['read'] AND NOT "scopes" && ARRAY['items:read'];--> statement-breakpoint

-- Indexes over renamed columns are rebuilt under their canonical definitions,
-- and the two Tech Spec §2.3 indexes that were missing are added.
DROP INDEX "items_variant_of_idx";--> statement-breakpoint
DROP INDEX "field_groups_type_order_idx";--> statement-breakpoint
DROP INDEX "fields_type_order_idx";--> statement-breakpoint
DROP INDEX "item_types_ws_idx";--> statement-breakpoint
DROP INDEX "ifi_field_text_idx";--> statement-breakpoint
DROP INDEX "ifi_field_number_idx";--> statement-breakpoint
DROP INDEX "ifi_field_date_idx";--> statement-breakpoint
DROP INDEX "ifi_field_bool_idx";--> statement-breakpoint
DROP INDEX "ifi_field_uuid_idx";--> statement-breakpoint
DROP INDEX "items_ws_type_idx";--> statement-breakpoint
DROP INDEX "items_parent_idx";--> statement-breakpoint
DROP INDEX "items_assignee_idx";--> statement-breakpoint
DROP INDEX "items_incomplete_idx";--> statement-breakpoint
DROP INDEX "tree_nodes_tree_parent_idx";--> statement-breakpoint
CREATE INDEX "items_values_gin" ON "items" USING gin ("effective_values" jsonb_path_ops);--> statement-breakpoint
CREATE INDEX "items_keyset_idx" ON "items" USING btree ("workspace_id","item_type_id","created_at" desc,"id" desc);--> statement-breakpoint
CREATE INDEX "items_variant_idx" ON "items" USING btree ("variant_parent_id") WHERE "items"."variant_parent_id" is not null and "items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "field_groups_type_order_idx" ON "field_groups" USING btree ("item_type_id","position");--> statement-breakpoint
CREATE INDEX "fields_type_order_idx" ON "fields" USING btree ("item_type_id","position") WHERE "fields"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "item_types_ws_idx" ON "item_types" USING btree ("workspace_id") WHERE "item_types"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "ifi_field_text_idx" ON "item_field_index" USING btree ("workspace_id","field_id","value_text") WHERE "item_field_index"."value_text" is not null;--> statement-breakpoint
CREATE INDEX "ifi_field_number_idx" ON "item_field_index" USING btree ("workspace_id","field_id","value_number") WHERE "item_field_index"."value_number" is not null;--> statement-breakpoint
CREATE INDEX "ifi_field_date_idx" ON "item_field_index" USING btree ("workspace_id","field_id","value_date") WHERE "item_field_index"."value_date" is not null;--> statement-breakpoint
CREATE INDEX "ifi_field_bool_idx" ON "item_field_index" USING btree ("workspace_id","field_id","value_bool") WHERE "item_field_index"."value_bool" is not null;--> statement-breakpoint
CREATE INDEX "ifi_field_uuid_idx" ON "item_field_index" USING btree ("workspace_id","field_id","value_uuid") WHERE "item_field_index"."value_uuid" is not null;--> statement-breakpoint
CREATE INDEX "items_ws_type_idx" ON "items" USING btree ("workspace_id","item_type_id","position") WHERE "items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "items_parent_idx" ON "items" USING btree ("parent_id","position") WHERE "items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "items_assignee_idx" ON "items" USING btree ("workspace_id","assignee_id") WHERE "items"."assignee_id" is not null and "items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "items_incomplete_idx" ON "items" USING btree ("workspace_id","item_type_id","completeness_pct") WHERE "items"."completeness_pct" < 100 and "items"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "tree_nodes_tree_parent_idx" ON "tree_nodes" USING btree ("tree_id","parent_id","position");--> statement-breakpoint

-- FK behaviour per Tech Spec §2.3/§2.6: RESTRICT forces the HAS_CHILDREN /
-- NODE_HAS_MEMBERS dispositions instead of silently taking a subtree.
ALTER TABLE "items" ADD CONSTRAINT "items_variant_parent_id_items_id_fk" FOREIGN KEY ("variant_parent_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_parent_id_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_nodes" ADD CONSTRAINT "tree_nodes_parent_id_tree_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tree_nodes"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_variant_model_is_root" CHECK (not "items"."is_variant_model" or ("items"."parent_id" is null and "items"."variant_parent_id" is null));--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_variant_not_in_hierarchy" CHECK ("items"."variant_parent_id" is null or "items"."parent_id" is null);
