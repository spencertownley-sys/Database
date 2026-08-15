-- API key resolution, which is a genuine bootstrap problem.
--
-- Every other read in the codebase runs inside `withWorkspace()`, which pins
-- `app.workspace_id` so RLS can filter. Authenticating an API key cannot: the
-- key *is* how we learn which workspace the caller belongs to, and both
-- `api_keys` and `workspace_members` are tenant tables. Reading them with no
-- context returns zero rows — RLS failing closed, exactly as designed — so
-- every key would be rejected as invalid.
--
-- A SECURITY DEFINER function is the standard answer: it executes as its owner
-- and therefore bypasses RLS, but only for this one narrow, parameterized
-- lookup. Three things keep that safe:
--
--   1. It takes only a *hash*. A caller who does not already hold the secret
--      cannot use it to enumerate anything — there is no listing form, no
--      wildcard, and no way to ask it for "all keys in workspace X".
--   2. `SET search_path = public` is pinned on the function. Without it, a
--      caller could create a shadowing `api_keys` in a schema earlier on their
--      own search_path and have the definer-privileged body read that instead.
--      This is the classic SECURITY DEFINER escalation and the pin is the fix.
--   3. It returns only the identity fields the auth layer needs. Nothing about
--      other keys, other members, or any item data crosses the boundary.
--
-- Everything after this lookup goes back through `withWorkspace()` as normal.

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_resolve_api_key(p_hashed_key text)
RETURNS TABLE (
  api_key_id uuid,
  workspace_id uuid,
  member_id uuid,
  user_id uuid,
  member_role member_role,
  scopes text[],
  member_status member_status,
  hashed_key text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    k.id,
    k.workspace_id,
    k.member_id,
    m.user_id,
    m.role,
    k.scopes,
    m.status,
    k.hashed_key
  FROM api_keys k
  JOIN workspace_members m ON m.id = k.member_id
  WHERE k.hashed_key = p_hashed_key
    AND k.revoked_at IS NULL
    AND (k.expires_at IS NULL OR k.expires_at > now())
  LIMIT 1
$$;

--> statement-breakpoint
-- Revoke the implicit PUBLIC grant before handing it to the app role, so the
-- function is callable only by the role that needs it.
REVOKE ALL ON FUNCTION app_resolve_api_key(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_resolve_api_key(text) TO strata_app;
