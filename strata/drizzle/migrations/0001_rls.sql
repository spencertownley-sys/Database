-- Tenant isolation, enforced by the database.
--
-- Application-level `WHERE workspace_id = ?` is a convention, and conventions
-- are forgotten in exactly the queries that matter — an ad-hoc report, a
-- recursive CTE, a filter compiler emitting SQL from user input. Row-level
-- security makes the isolation an invariant of the storage engine instead.
--
-- Three parts, all required together:
--
--   1. A dedicated non-owner role. Table owners bypass RLS by default and
--      superusers bypass it unconditionally, so an app connecting as the
--      owner has policies that are decorative. `strata_app` owns nothing.
--   2. FORCE ROW LEVEL SECURITY, so even a connection that *is* the owner
--      still gets filtered. Migrations use DDL (unaffected) and the seed runs
--      as a superuser (which still bypasses, deliberately).
--   3. Policies keyed on `current_setting('app.workspace_id', true)`, which
--      `withWorkspace()` sets transaction-locally via `set_config(..., true)`.
--
-- Fail-closed by construction: with no `app.workspace_id` set, the setting is
-- NULL, `workspace_id = NULL` evaluates to NULL, and the row is not visible.
-- A forgotten context yields zero rows, never another tenant's rows.

--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'strata_app') THEN
    CREATE ROLE strata_app NOLOGIN;
  END IF;
END
$$;

--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO strata_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO strata_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO strata_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO strata_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO strata_app;

--> statement-breakpoint
-- STABLE, not IMMUTABLE: the setting can change between transactions, and an
-- IMMUTABLE marking would let the planner cache one tenant's value into a
-- plan reused by another.
CREATE OR REPLACE FUNCTION app_current_workspace_id() RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('app.workspace_id', true), '')::uuid
$$;

--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_current_workspace_id() TO strata_app;

--> statement-breakpoint
DO $$
DECLARE
  t text;
  tenant_tables text[] := ARRAY[
    'workspace_members',
    'guest_scopes',
    'item_types',
    'field_groups',
    'fields',
    'items',
    'item_field_index',
    'trees',
    'tree_nodes',
    'item_tree_nodes',
    'change_sets',
    'change_entries',
    'views',
    'import_profiles',
    'import_jobs',
    'export_jobs',
    'api_keys',
    'webhooks',
    'webhook_deliveries',
    'notifications'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant_isolation', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (workspace_id = app_current_workspace_id()) '
      'WITH CHECK (workspace_id = app_current_workspace_id())',
      t || '_tenant_isolation', t
    );
  END LOOP;
END
$$;

--> statement-breakpoint
-- `workspaces` is the tenant root, not a tenant row: the slug has to be
-- resolvable before any workspace context exists, so SELECT stays open and
-- only the mutating paths are pinned to the active workspace.
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspaces" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspaces_select" ON "workspaces" FOR SELECT USING (true);
--> statement-breakpoint
CREATE POLICY "workspaces_insert" ON "workspaces" FOR INSERT WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "workspaces_update" ON "workspaces" FOR UPDATE
  USING ("id" = app_current_workspace_id())
  WITH CHECK ("id" = app_current_workspace_id());
--> statement-breakpoint
CREATE POLICY "workspaces_delete" ON "workspaces" FOR DELETE
  USING ("id" = app_current_workspace_id());

--> statement-breakpoint
-- `users` is deliberately global: one person belongs to several workspaces,
-- and membership (`workspace_members`, which *is* isolated) is the scoping
-- edge. Nothing reads a user row without first resolving a member row.
COMMENT ON TABLE "users" IS
  'Global by design: scoped through workspace_members, which carries the RLS policy.';
