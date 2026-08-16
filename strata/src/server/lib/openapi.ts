/**
 * The OpenAPI 3.1 document for `/api/v1`.
 *
 * Deliberately summary-level: every path and method is present (the coverage
 * test enforces that), with the envelope, auth, and error model described
 * once and referenced. Full request-body JSON Schemas generated from the Zod
 * validators would need the zod v4 `toJSONSchema` API; this codebase is on
 * the v3 classes, so bodies are described by example — the validators remain
 * the runtime source of truth either way.
 */

import { ERROR_CODES } from './errors';

const auth = { description: 'Requires `X-Workspace-Id` plus a session cookie or `Authorization: Bearer sk_live_…`.' };
const anonymous = { description: 'Unauthenticated by design.' };

interface Op {
  summary: string;
  description?: string;
}

/** path → method → operation. Snake_case wire format throughout (§1.2). */
const paths: Record<string, Partial<Record<'get' | 'post' | 'patch' | 'delete', Op>>> = {
  '/api/v1/auth/signup': { post: { summary: 'Create an account' } },
  '/api/v1/auth/login': { post: { summary: 'Start a session' } },
  '/api/v1/auth/logout': { post: { summary: 'End the session' } },
  '/api/v1/auth/me': { get: { summary: 'The signed-in user and their memberships' } },

  '/api/v1/workspaces': { get: { summary: 'List memberships (no X-Workspace-Id needed)' }, post: { summary: 'Create a workspace' } },
  '/api/v1/workspaces/{id}': { get: { summary: 'Workspace detail with counts' }, patch: { summary: 'Rename / settings (owner)' } },

  '/api/v1/item-types': { get: { summary: 'List item types' }, post: { summary: 'Create an item type (preset or blank)' } },
  '/api/v1/item-types/{id}': { get: { summary: 'Type with fields and groups' }, patch: { summary: 'Update labels / settings' }, delete: { summary: 'Delete; needs ?confirm=<key> when in use' } },
  '/api/v1/field-groups': { post: { summary: 'Create a field group' } },
  '/api/v1/field-groups/{id}': { patch: { summary: 'Rename / reorder' }, delete: { summary: 'Delete (fields move to default)' } },
  '/api/v1/fields': { post: { summary: 'Add a field to a type' } },
  '/api/v1/fields/{id}': { patch: { summary: 'Update; `type` change needs confirm_conversion; `is_indexed: true` backfills' }, delete: { summary: 'Soft delete, 30-day restore' } },

  '/api/v1/items': { get: { summary: 'List/filter/sort items — the grid query. Collection envelope; keyset cursor' }, post: { summary: 'Create items (change set underneath)' } },
  '/api/v1/items/{id}': { get: { summary: 'One item; ?expand=item_type,parent,ancestors,children,variants,variant_parent,tree_nodes' }, patch: { summary: 'Partial update; `revert_fields` reverts variant overrides' }, delete: { summary: 'Archive; ?cascade=true when it has children' } },
  '/api/v1/items/{id}/generate-variants': { post: { summary: 'Axis values → variants, one change set; `preview` defaults true' } },

  '/api/v1/change-sets': { get: { summary: 'Activity feed; ?item_id= for per-item history' }, post: { summary: 'Preview (writes nothing); `auto_commit` for single-item edits' } },
  '/api/v1/change-sets/{id}': { get: { summary: 'Status, summary, samples' }, delete: { summary: 'Discard a preview' } },
  '/api/v1/change-sets/{id}/entries': { get: { summary: 'Per-item, per-field before/after rows' } },
  '/api/v1/change-sets/{id}/commit': { post: { summary: 'Apply; STALE_PREVIEW if items changed since preview' } },
  '/api/v1/change-sets/{id}/undo': { post: { summary: 'Inverse set; 24h window' } },

  '/api/v1/trees': { get: { summary: 'List category trees' }, post: { summary: 'Create (v1: one custom tree)' } },
  '/api/v1/trees/{id}': { patch: { summary: 'Rename' }, delete: { summary: 'Delete when empty of members' } },
  '/api/v1/trees/{id}/nodes': { get: { summary: 'All nodes with counts and subtree rollups' }, post: { summary: 'Add a node' } },
  '/api/v1/tree-nodes/{id}': { patch: { summary: 'Rename / reparent / reorder' }, delete: { summary: 'Needs ?on_members=unassign|move_to_parent|move_to' } },
  '/api/v1/tree-nodes/{id}/items': { post: { summary: 'Bulk assign (change set)' }, delete: { summary: 'Bulk unassign (change set)' } },

  '/api/v1/views': { get: { summary: 'List views the caller can see' }, post: { summary: 'Create; visibility private|workspace|shared' } },
  '/api/v1/views/{id}': { get: { summary: 'One view' }, patch: { summary: 'Update; sharing mints a token, un-sharing destroys it' }, delete: { summary: 'Soft delete + token revoke' } },
  '/api/v1/views/{id}/items': { get: { summary: 'The view, applied — convenience for GET /items' } },

  '/api/v1/imports': { get: { summary: 'Recent import jobs' }, post: { summary: 'Multipart upload: file, item_type_id, import_profile_id?' } },
  '/api/v1/imports/{id}': { get: { summary: 'Job with dry-run report' } },
  '/api/v1/imports/{id}/mapping': { patch: { summary: 'Set mapping; runs the dry run synchronously' } },
  '/api/v1/imports/{id}/commit': { post: { summary: 'One change set; response carries change_set_id for undo' } },
  '/api/v1/imports/{id}/errors.csv': { get: { summary: 'Per-row error CSV (signed token auth)' } },
  '/api/v1/import-profiles': { get: { summary: 'Saved mappings' }, post: { summary: 'Save a mapping' } },
  '/api/v1/import-profiles/{id}': { delete: { summary: 'Delete a profile' } },
  '/api/v1/exports': { post: { summary: 'Export the current view as CSV; injection-guarded; signed download URL' } },
  '/api/v1/exports/{id}': { get: { summary: 'Status + freshly signed download URL' } },
  '/api/v1/exports/{id}/download': { get: { summary: 'The file (signed token auth)' } },

  '/api/v1/members': { get: { summary: 'Workspace members' } },
  '/api/v1/notifications': { get: { summary: 'The caller’s inbox; ?unread_only=true' } },
  '/api/v1/notifications/read': { post: { summary: '{ids: […]} or {all: true}' } },
  '/api/v1/api-keys': { get: { summary: 'List keys (prefix only)' }, post: { summary: 'Create; secret returned once; guests refused' } },
  '/api/v1/api-keys/{id}': { delete: { summary: 'Revoke' } },

  '/api/v1/webhooks': { get: { summary: 'List endpoints' }, post: { summary: 'Subscribe; secret returned once' } },
  '/api/v1/webhooks/{id}': { patch: { summary: 'Update; re-activating resets the failure count' }, delete: { summary: 'Remove' } },
  '/api/v1/webhooks/{id}/test': { post: { summary: 'Signed synthetic delivery' } },
  '/api/v1/webhooks/{id}/deliveries': { get: { summary: 'Recent attempts with status codes' } },

  '/api/health': { get: { summary: 'Uptime probe', ...anonymous } },
  '/api/openapi': { get: { summary: 'This document', ...anonymous } },
};

export const spec = {
  openapi: '3.1.0',
  info: {
    title: 'Strata API',
    version: '1.0.0',
    description: [
      'The same API the app uses. Bodies are snake_case. Collections come as',
      '`{data, meta: {cursor, has_more, total}}` with keyset cursors (never offsets).',
      'Errors always look like `{error: {code, message, details, request_id}}` —',
      'the code table is under `components.x-error-codes`.',
      auth.description,
    ].join(' '),
  },
  servers: [{ url: '/' }],
  paths: Object.fromEntries(
    Object.entries(paths).map(([path, methods]) => [
      path,
      Object.fromEntries(
        Object.entries(methods).map(([method, op]) => [
          method,
          {
            summary: op.summary,
            ...(op.description ? { description: op.description } : {}),
            responses: {
              default: { $ref: '#/components/responses/Envelope' },
            },
          },
        ]),
      ),
    ]),
  ),
  components: {
    securitySchemes: {
      session: { type: 'apiKey', in: 'cookie', name: 'session' },
      apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'sk_live_…' },
      workspace: { type: 'apiKey', in: 'header', name: 'X-Workspace-Id' },
    },
    responses: {
      Envelope: {
        description:
          'Success: the resource (or a {data, meta} collection). Failure: {error: {code, message, details, request_id}}.',
      },
    },
    'x-error-codes': Object.fromEntries(
      Object.entries(ERROR_CODES).map(([code, status]) => [code, { status }]),
    ),
  },
} as const;
