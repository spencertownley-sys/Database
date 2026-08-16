-- Workspace-discovery resolution — the third instance of the same RLS
-- bootstrap problem (0004: API keys, 0009: share tokens).
--
-- "Which workspaces does this user belong to" has to run before any
-- workspace is pinned, but `workspace_members` is RLS-scoped like every
-- other tenant table, so an unpinned read from the app role correctly
-- returns nothing (CLAUDE.md: fail-closed by design). Real login needs this
-- answer to route a returning user straight to their workspace, or a
-- first-time user to onboarding.
--
-- Same three safety properties as the earlier two functions:
--   1. Takes only a user id — and that id comes from a verified Supabase
--      session (`auth.uid()`-backed local user row), never from client
--      input, so this cannot be used to enumerate anyone else's workspaces.
--   2. `SET search_path = public` pins the body against schema shadowing.
--   3. Returns membership rows for that one user only — no other tenant
--      data crosses the boundary.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_list_user_workspaces(p_user_id uuid)
RETURNS TABLE (
  workspace_id uuid,
  slug text,
  name text,
  role member_role
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id, w.slug, w.name, m.role
  FROM workspace_members m
  JOIN workspaces w ON w.id = m.workspace_id
  WHERE m.user_id = p_user_id
    AND m.status = 'active'
    AND w.deleted_at IS NULL
  ORDER BY m.created_at
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION app_list_user_workspaces(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_list_user_workspaces(uuid) TO strata_app;
