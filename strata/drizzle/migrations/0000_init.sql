CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'editor', 'viewer', 'guest');--> statement-breakpoint
CREATE TYPE "public"."member_status" AS ENUM('pending', 'active', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."workspace_plan" AS ENUM('free', 'team', 'business');--> statement-breakpoint
CREATE TYPE "public"."field_type" AS ENUM('text', 'long_text', 'number', 'currency', 'percent', 'date', 'datetime', 'select', 'multi_select', 'checkbox', 'url', 'email', 'user', 'relation');--> statement-breakpoint
CREATE TYPE "public"."field_inheritance" AS ENUM('shared', 'variant');--> statement-breakpoint
CREATE TYPE "public"."change_operation" AS ENUM('create', 'set_field', 'clear_field', 'change_type', 'reparent', 'tree_assign', 'tree_unassign', 'delete', 'assign_user', 'variant_propagate');--> statement-breakpoint
CREATE TYPE "public"."change_set_status" AS ENUM('preview', 'committing', 'committed', 'undone', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."change_source" AS ENUM('user', 'api', 'import', 'undo', 'job', 'system');--> statement-breakpoint
CREATE TYPE "public"."view_kind" AS ENUM('grid', 'list', 'board');--> statement-breakpoint
CREATE TYPE "public"."view_visibility" AS ENUM('private', 'workspace', 'shared');--> statement-breakpoint
CREATE TYPE "public"."export_format" AS ENUM('csv', 'xlsx');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('queued', 'generating', 'ready', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('uploaded', 'parsing', 'mapping', 'validating', 'validated', 'committing', 'committed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."webhook_delivery_status" AS ENUM('pending', 'delivering', 'succeeded', 'failed', 'exhausted');--> statement-breakpoint
CREATE TYPE "public"."notification_kind" AS ENUM('assigned', 'invited', 'import_completed', 'export_ready', 'bulk_completed', 'variant_propagated', 'webhook_disabled');--> statement-breakpoint
CREATE TABLE "guest_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"tree_node_id" uuid NOT NULL,
	"include_descendants" boolean DEFAULT true NOT NULL,
	"can_edit" boolean DEFAULT false NOT NULL,
	"editable_field_keys" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid,
	"email" text NOT NULL,
	"name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"invited_email" text,
	"role" "member_role" DEFAULT 'editor' NOT NULL,
	"status" "member_status" DEFAULT 'pending' NOT NULL,
	"invite_token" text,
	"invite_expires_at" timestamp with time zone,
	"invited_by" uuid,
	"accepted_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"plan" "workspace_plan" DEFAULT 'free' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "field_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"item_type_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text,
	"order_key" text NOT NULL,
	"collapsed_by_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"item_type_id" uuid NOT NULL,
	"field_group_id" uuid,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" "field_type" NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"help_text" text,
	"required" boolean DEFAULT false NOT NULL,
	"default_value" jsonb,
	"inheritance" "field_inheritance" DEFAULT 'shared' NOT NULL,
	"is_indexed" boolean DEFAULT false NOT NULL,
	"is_searchable" boolean DEFAULT false NOT NULL,
	"counts_toward_completeness" boolean DEFAULT true NOT NULL,
	"order_key" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "item_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"plural_name" text,
	"description" text,
	"icon" text,
	"color" text,
	"preset_key" text,
	"variant_axes" text[] DEFAULT '{}'::text[] NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"default_view_id" uuid,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "item_field_index" (
	"workspace_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"item_type_id" uuid NOT NULL,
	"value_text" text,
	"value_number" numeric(38, 10),
	"value_date" timestamp with time zone,
	"value_bool" boolean,
	"value_uuid" uuid,
	"value_text_array" text[],
	CONSTRAINT "item_field_index_item_id_field_id_pk" PRIMARY KEY("item_id","field_id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"item_type_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"parent_id" uuid,
	"path" "ltree" NOT NULL,
	"order_key" text NOT NULL,
	"is_variant_model" boolean DEFAULT false NOT NULL,
	"variant_of_id" uuid,
	"variant_axis_values" jsonb,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"effective_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"invalid_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completeness_pct" integer DEFAULT 0 NOT NULL,
	"missing_required" text[] DEFAULT '{}'::text[] NOT NULL,
	"search_text" text DEFAULT '' NOT NULL,
	"assignee_id" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "items_variant_model_is_root" CHECK (not "items"."is_variant_model" or ("items"."parent_id" is null and "items"."variant_of_id" is null)),
	CONSTRAINT "items_variant_not_in_hierarchy" CHECK ("items"."variant_of_id" is null or "items"."parent_id" is null)
);
--> statement-breakpoint
CREATE TABLE "item_tree_nodes" (
	"workspace_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"tree_node_id" uuid NOT NULL,
	"tree_id" uuid NOT NULL,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_tree_nodes_item_id_tree_node_id_pk" PRIMARY KEY("item_id","tree_node_id")
);
--> statement-breakpoint
CREATE TABLE "tree_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"tree_id" uuid NOT NULL,
	"parent_id" uuid,
	"path" "ltree" NOT NULL,
	"order_key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "change_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"change_set_id" uuid NOT NULL,
	"item_id" uuid,
	"seq" integer DEFAULT 0 NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"skipped" boolean DEFAULT false NOT NULL,
	"skip_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "change_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"operation" "change_operation" NOT NULL,
	"status" "change_set_status" DEFAULT 'preview' NOT NULL,
	"source" "change_source" DEFAULT 'user' NOT NULL,
	"item_type_id" uuid,
	"actor_id" uuid,
	"actor_api_key_id" uuid,
	"target" jsonb NOT NULL,
	"patch" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"summary" jsonb DEFAULT '{"byField":{}}'::jsonb NOT NULL,
	"sample_entries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"parent_change_set_id" uuid,
	"undone_by_change_set_id" uuid,
	"idempotency_key" text,
	"job_id" text,
	"progress" integer DEFAULT 0 NOT NULL,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone,
	"undone_at" timestamp with time zone,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"item_type_id" uuid NOT NULL,
	"kind" "view_kind" DEFAULT 'grid' NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"visibility" "view_visibility" DEFAULT 'private' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"share_token" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"owner_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"item_type_id" uuid,
	"view_id" uuid,
	"status" "export_status" DEFAULT 'queued' NOT NULL,
	"format" "export_format" DEFAULT 'csv' NOT NULL,
	"query" jsonb,
	"row_count" integer DEFAULT 0 NOT NULL,
	"storage_path" text,
	"expires_at" timestamp with time zone,
	"error" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"item_type_id" uuid NOT NULL,
	"profile_id" uuid,
	"status" "import_status" DEFAULT 'uploaded' NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer DEFAULT 0 NOT NULL,
	"storage_path" text NOT NULL,
	"mime_type" text,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"match_key" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"detected_headers" text[],
	"preview_rows" jsonb,
	"row_count" integer DEFAULT 0 NOT NULL,
	"new_count" integer DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"report" jsonb,
	"error_csv_path" text,
	"change_set_id" uuid,
	"error" jsonb,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "import_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"item_type_id" uuid NOT NULL,
	"name" text NOT NULL,
	"mapping" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"match_key" text,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"hashed_key" text NOT NULL,
	"scopes" text[] DEFAULT '{read}'::text[] NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "webhook_delivery_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"response_status" integer,
	"response_snippet" text,
	"error" text,
	"next_attempt_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"url" text NOT NULL,
	"events" text[] DEFAULT '{}'::text[] NOT NULL,
	"secret" text NOT NULL,
	"description" text,
	"active" boolean DEFAULT true NOT NULL,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"disabled_reason" text,
	"last_delivery_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "notification_kind" NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"href" text,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"emailed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_scopes" ADD CONSTRAINT "guest_scopes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_scopes" ADD CONSTRAINT "guest_scopes_member_id_workspace_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."workspace_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_groups" ADD CONSTRAINT "field_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_groups" ADD CONSTRAINT "field_groups_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_field_group_id_field_groups_id_fk" FOREIGN KEY ("field_group_id") REFERENCES "public"."field_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_types" ADD CONSTRAINT "item_types_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_types" ADD CONSTRAINT "item_types_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_field_index" ADD CONSTRAINT "item_field_index_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_field_index" ADD CONSTRAINT "item_field_index_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_field_index" ADD CONSTRAINT "item_field_index_field_id_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_parent_id_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_variant_of_id_items_id_fk" FOREIGN KEY ("variant_of_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_assignee_id_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tree_nodes" ADD CONSTRAINT "item_tree_nodes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tree_nodes" ADD CONSTRAINT "item_tree_nodes_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tree_nodes" ADD CONSTRAINT "item_tree_nodes_tree_node_id_tree_nodes_id_fk" FOREIGN KEY ("tree_node_id") REFERENCES "public"."tree_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tree_nodes" ADD CONSTRAINT "item_tree_nodes_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_tree_nodes" ADD CONSTRAINT "item_tree_nodes_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_nodes" ADD CONSTRAINT "tree_nodes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_nodes" ADD CONSTRAINT "tree_nodes_tree_id_trees_id_fk" FOREIGN KEY ("tree_id") REFERENCES "public"."trees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tree_nodes" ADD CONSTRAINT "tree_nodes_parent_id_tree_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tree_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trees" ADD CONSTRAINT "trees_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_entries" ADD CONSTRAINT "change_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_entries" ADD CONSTRAINT "change_entries_change_set_id_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_entries" ADD CONSTRAINT "change_entries_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_sets" ADD CONSTRAINT "change_sets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_sets" ADD CONSTRAINT "change_sets_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_sets" ADD CONSTRAINT "change_sets_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_sets" ADD CONSTRAINT "change_sets_parent_change_set_id_change_sets_id_fk" FOREIGN KEY ("parent_change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "views" ADD CONSTRAINT "views_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_profile_id_import_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."import_profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_change_set_id_change_sets_id_fk" FOREIGN KEY ("change_set_id") REFERENCES "public"."change_sets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD CONSTRAINT "import_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_profiles" ADD CONSTRAINT "import_profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_profiles" ADD CONSTRAINT "import_profiles_item_type_id_item_types_id_fk" FOREIGN KEY ("item_type_id") REFERENCES "public"."item_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_profiles" ADD CONSTRAINT "import_profiles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_member_id_workspace_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."workspace_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guest_scopes_member_node_key" ON "guest_scopes" USING btree ("member_id","tree_node_id");--> statement-breakpoint
CREATE INDEX "guest_scopes_ws_member_idx" ON "guest_scopes" USING btree ("workspace_id","member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_user_id_key" ON "users" USING btree ("auth_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_ws_user_key" ON "workspace_members" USING btree ("workspace_id","user_id") WHERE "workspace_members"."user_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_ws_email_key" ON "workspace_members" USING btree ("workspace_id",lower("invited_email")) WHERE "workspace_members"."invited_email" is not null and "workspace_members"."user_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_members_invite_token_key" ON "workspace_members" USING btree ("invite_token") WHERE "workspace_members"."invite_token" is not null;--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_key" ON "workspaces" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "field_groups_type_key_key" ON "field_groups" USING btree ("item_type_id","key");--> statement-breakpoint
CREATE INDEX "field_groups_type_order_idx" ON "field_groups" USING btree ("item_type_id","order_key");--> statement-breakpoint
CREATE UNIQUE INDEX "fields_type_key_key" ON "fields" USING btree ("item_type_id","key") WHERE "fields"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "fields_type_order_idx" ON "fields" USING btree ("item_type_id","order_key") WHERE "fields"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "fields_ws_idx" ON "fields" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "fields_indexed_idx" ON "fields" USING btree ("item_type_id") WHERE "fields"."is_indexed" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "item_types_ws_key_key" ON "item_types" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "item_types_ws_idx" ON "item_types" USING btree ("workspace_id") WHERE "item_types"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "ifi_field_text_idx" ON "item_field_index" USING btree ("field_id","value_text") WHERE "item_field_index"."value_text" is not null;--> statement-breakpoint
CREATE INDEX "ifi_field_number_idx" ON "item_field_index" USING btree ("field_id","value_number") WHERE "item_field_index"."value_number" is not null;--> statement-breakpoint
CREATE INDEX "ifi_field_date_idx" ON "item_field_index" USING btree ("field_id","value_date") WHERE "item_field_index"."value_date" is not null;--> statement-breakpoint
CREATE INDEX "ifi_field_bool_idx" ON "item_field_index" USING btree ("field_id","value_bool") WHERE "item_field_index"."value_bool" is not null;--> statement-breakpoint
CREATE INDEX "ifi_field_uuid_idx" ON "item_field_index" USING btree ("field_id","value_uuid") WHERE "item_field_index"."value_uuid" is not null;--> statement-breakpoint
CREATE INDEX "ifi_field_array_idx" ON "item_field_index" USING gin ("value_text_array") WHERE "item_field_index"."value_text_array" is not null;--> statement-breakpoint
CREATE INDEX "ifi_ws_type_idx" ON "item_field_index" USING btree ("workspace_id","item_type_id");--> statement-breakpoint
CREATE INDEX "items_path_gist" ON "items" USING gist ("path");--> statement-breakpoint
CREATE INDEX "items_search_trgm" ON "items" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "items_ws_type_idx" ON "items" USING btree ("workspace_id","item_type_id","order_key") WHERE "items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "items_parent_idx" ON "items" USING btree ("parent_id","order_key") WHERE "items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "items_variant_of_idx" ON "items" USING btree ("variant_of_id") WHERE "items"."variant_of_id" is not null and "items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "items_assignee_idx" ON "items" USING btree ("workspace_id","assignee_id") WHERE "items"."assignee_id" is not null and "items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "items_incomplete_idx" ON "items" USING btree ("workspace_id","item_type_id","completeness_pct") WHERE "items"."completeness_pct" < 100 and "items"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "items_updated_idx" ON "items" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "itn_node_idx" ON "item_tree_nodes" USING btree ("tree_node_id");--> statement-breakpoint
CREATE INDEX "itn_ws_tree_idx" ON "item_tree_nodes" USING btree ("workspace_id","tree_id");--> statement-breakpoint
CREATE INDEX "tree_nodes_path_gist" ON "tree_nodes" USING gist ("path");--> statement-breakpoint
CREATE INDEX "tree_nodes_tree_parent_idx" ON "tree_nodes" USING btree ("tree_id","parent_id","order_key");--> statement-breakpoint
CREATE INDEX "tree_nodes_ws_idx" ON "tree_nodes" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "trees_ws_key_key" ON "trees" USING btree ("workspace_id","key");--> statement-breakpoint
CREATE INDEX "change_entries_set_idx" ON "change_entries" USING btree ("change_set_id","seq");--> statement-breakpoint
CREATE INDEX "change_entries_item_idx" ON "change_entries" USING btree ("workspace_id","item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "change_sets_idempotency_key" ON "change_sets" USING btree ("workspace_id","idempotency_key") WHERE "change_sets"."idempotency_key" is not null;--> statement-breakpoint
CREATE INDEX "change_sets_ws_created_idx" ON "change_sets" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "change_sets_ws_status_idx" ON "change_sets" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "change_sets_actor_idx" ON "change_sets" USING btree ("workspace_id","actor_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "views_share_token_key" ON "views" USING btree ("share_token") WHERE "views"."share_token" is not null;--> statement-breakpoint
CREATE INDEX "views_ws_type_idx" ON "views" USING btree ("workspace_id","item_type_id") WHERE "views"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "views_owner_idx" ON "views" USING btree ("workspace_id","owner_id");--> statement-breakpoint
CREATE INDEX "export_jobs_ws_created_idx" ON "export_jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "import_jobs_ws_created_idx" ON "import_jobs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "import_jobs_status_idx" ON "import_jobs" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "import_profiles_ws_type_name_key" ON "import_profiles" USING btree ("workspace_id","item_type_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hashed_key" ON "api_keys" USING btree ("hashed_key");--> statement-breakpoint
CREATE INDEX "api_keys_ws_idx" ON "api_keys" USING btree ("workspace_id") WHERE "api_keys"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "api_keys_prefix_idx" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_hook_idx" ON "webhook_deliveries" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_pending_idx" ON "webhook_deliveries" USING btree ("next_attempt_at") WHERE "webhook_deliveries"."status" in ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "webhooks_ws_active_idx" ON "webhooks" USING btree ("workspace_id") WHERE "webhooks"."active" = true;--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("workspace_id","user_id","created_at") WHERE "notifications"."read_at" is null;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("workspace_id","user_id","created_at");