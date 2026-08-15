-- Share-token resolution — the second genuine RLS bootstrap problem.
--
-- `/share/:token` is anonymous by design (API Design §7): there is no member,
-- no session, and no `X-Workspace-Id`, so nothing can pin `app.workspace_id`
-- before reading `views` — and `views` is a tenant table, so the unpinned read
-- correctly returns nothing. Same shape as API key resolution (0004), same
-- narrow answer: a SECURITY DEFINER lookup that trades exactly one secret for
-- exactly one row.
--
-- The same three properties keep it safe:
--   1. It takes the full token — unguessable 192-bit random — and has no
--      listing form. You cannot ask it what exists, only redeem what you hold.
--   2. `SET search_path = public` pins the body against schema shadowing.
--   3. It returns the view row and its workspace id, nothing more. The share
--      page then pins that workspace and reads item data through RLS as
--      normal.
--
-- Revoking the token (visibility change, view deletion) nulls `share_token`,
-- so a revoked link stops resolving immediately.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_resolve_share_token(p_token text)
RETURNS TABLE (
  view_id uuid,
  workspace_id uuid,
  item_type_id uuid,
  view_type view_kind,
  name text,
  description text,
  config jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.id, v.workspace_id, v.item_type_id, v.type, v.name, v.description, v.config
  FROM views v
  WHERE v.share_token = p_token
    AND v.visibility = 'shared'
    AND v.deleted_at IS NULL
  LIMIT 1
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION app_resolve_share_token(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_resolve_share_token(text) TO strata_app;
