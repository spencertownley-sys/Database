/**
 * The single authorisation decision point.
 *
 * Every route handler calls `can()` (or `assertCan()`), and nothing else in the
 * codebase encodes a role comparison. Scattering `role === 'admin'` checks
 * through services is how a permission model drifts: one path gets updated, the
 * other three do not, and the gap is only found by whoever it lets through.
 *
 * `can()` returns `true` or a **`Denial` carrying a specific message**, never a
 * bare boolean. A denial the user can read ("Viewers can't edit items — ask an
 * admin to change your role") is the difference between a product that seems
 * broken and one that seems governed. A silent no-op is the worst of both.
 *
 * Two boundaries deserve their reasoning stated:
 *
 *  - **Editors cannot change the schema.** Item Types, fields, and category
 *    trees are the shared vocabulary of the workspace; one person renaming a
 *    field type changes every teammate's grid. Editors own *data*, admins own
 *    *structure*.
 *
 *  - **Guests have no API access at all.** A guest's field subset is enforced
 *    by the renderer, which makes it presentation rather than security. Rather
 *    than ship an API that quietly ignores that subset, v1 denies guests the
 *    API entirely — that is what contains the field-permission gap until
 *    field-level permissions land in Phase 2.
 */

import type { MemberRole } from '@/server/db/schema/workspaces';
import type { ApiKeyScope } from '@/server/db/schema/apiKeys';
import { AppError, type ErrorCode } from '@/server/lib/errors';
import { isAtOrBelow } from '@/server/lib/ltree';

export const ACTIONS = [
  // workspace
  'workspace.read',
  'workspace.update',
  'workspace.delete',
  'workspace.manage_members',
  'workspace.manage_billing',
  // schema
  'item_type.read',
  'item_type.create',
  'item_type.update',
  'item_type.delete',
  'field.create',
  'field.update',
  'field.delete',
  'field.restore',
  // data
  'item.read',
  'item.create',
  'item.update',
  'item.delete',
  'item.bulk_edit',
  'item.reparent',
  'item.assign',
  // trees
  'tree.read',
  'tree.create',
  'tree.update',
  'tree.delete',
  'tree_node.create',
  'tree_node.update',
  'tree_node.delete',
  'tree_node.assign_items',
  // variants
  'variant.generate',
  'variant.override',
  // views
  'view.read',
  'view.create',
  'view.update',
  'view.delete',
  'view.share',
  // change sets
  'change_set.preview',
  'change_set.commit',
  'change_set.undo',
  // transfer
  'import.create',
  'import.commit',
  'export.create',
  // integrations
  'api_key.list',
  'api_key.create',
  'api_key.revoke',
  'webhook.read',
  'webhook.create',
  'webhook.update',
  'webhook.delete',
  // activity
  'activity.read',
] as const;

export type Action = (typeof ACTIONS)[number];

export interface Denial {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export type Decision = true | Denial;

export interface GuestScopeSummary {
  treeNodeId: string;
  /** ltree path of the scoped node, for descendant matching. */
  treeNodePath: string;
  includeDescendants: boolean;
  canEdit: boolean;
  editableFieldKeys: string[] | null;
}

export interface Actor {
  userId: string | null;
  workspaceId: string;
  memberId: string;
  role: MemberRole;
  /** Present when the request authenticated with an API key rather than a session. */
  apiKey?: { id: string; scopes: ApiKeyScope[] };
  /** Populated for guests only. */
  guestScopes?: GuestScopeSummary[];
}

/**
 * Resource context. Anything the decision depends on beyond the role has to be
 * supplied by the caller — `can()` performs no I/O, which keeps it pure,
 * synchronous, exhaustively testable, and impossible to accidentally call in a
 * loop that issues a query per item.
 */
export type Resource =
  | { kind: 'workspace' }
  | { kind: 'item_type' }
  | { kind: 'field' }
  | {
      kind: 'item';
      /** ltree paths of every tree node the item belongs to. Required for guests. */
      treeNodePaths?: string[];
      /** Field keys the write touches, for the guest editable-field check. */
      fieldKeys?: string[];
      itemCount?: number;
    }
  | { kind: 'tree' }
  | { kind: 'tree_node'; path?: string }
  | { kind: 'view'; ownerId?: string | null; visibility?: 'private' | 'workspace' | 'shared' }
  | { kind: 'change_set'; actorId?: string | null; source?: string }
  | { kind: 'import' }
  | { kind: 'export' }
  | { kind: 'api_key' }
  | { kind: 'webhook' }
  | { kind: 'activity' };

const ALL: readonly Action[] = ACTIONS;

const ADMIN_DENIED: readonly Action[] = ['workspace.delete', 'workspace.manage_billing'];

const EDITOR_ALLOWED: readonly Action[] = [
  'workspace.read',
  'item_type.read',
  'item.read',
  'item.create',
  'item.update',
  'item.delete',
  'item.bulk_edit',
  'item.reparent',
  'item.assign',
  'tree.read',
  'tree_node.assign_items',
  'variant.generate',
  'variant.override',
  'view.read',
  'view.create',
  'view.update',
  'view.delete',
  'view.share',
  'change_set.preview',
  'change_set.commit',
  'change_set.undo',
  'import.create',
  'import.commit',
  'export.create',
  'webhook.read',
  'activity.read',
];

const VIEWER_ALLOWED: readonly Action[] = [
  'workspace.read',
  'item_type.read',
  'item.read',
  'tree.read',
  'view.read',
  // A viewer saving their own lens changes nothing anyone else sees, and
  // denying it makes a read-only seat useless for actual reading.
  'view.create',
  'view.update',
  'view.delete',
  'export.create',
  'activity.read',
];

const GUEST_ALLOWED: readonly Action[] = [
  'workspace.read',
  'item_type.read',
  'item.read',
  'item.update',
  'tree.read',
  'view.read',
  'change_set.preview',
  'change_set.commit',
];

const ROLE_MATRIX: Record<MemberRole, ReadonlySet<Action>> = {
  owner: new Set(ALL),
  admin: new Set(ALL.filter((a) => !ADMIN_DENIED.includes(a))),
  editor: new Set(EDITOR_ALLOWED),
  viewer: new Set(VIEWER_ALLOWED),
  guest: new Set(GUEST_ALLOWED),
};

/** Actions an API key needs `write` scope for; everything else needs `read`. */
const WRITE_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'workspace.update',
  'item_type.create',
  'item_type.update',
  'item_type.delete',
  'field.create',
  'field.update',
  'field.delete',
  'field.restore',
  'item.create',
  'item.update',
  'item.delete',
  'item.bulk_edit',
  'item.reparent',
  'item.assign',
  'tree.create',
  'tree.update',
  'tree.delete',
  'tree_node.create',
  'tree_node.update',
  'tree_node.delete',
  'tree_node.assign_items',
  'variant.generate',
  'variant.override',
  'view.create',
  'view.update',
  'view.delete',
  'view.share',
  'change_set.commit',
  'change_set.undo',
  'import.create',
  'import.commit',
  'export.create',
]);

const ADMIN_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'workspace.delete',
  'workspace.manage_members',
  'workspace.manage_billing',
  'api_key.list',
  'api_key.create',
  'api_key.revoke',
  'webhook.create',
  'webhook.update',
  'webhook.delete',
]);

const ROLE_LABEL: Record<MemberRole, string> = {
  owner: 'Owners',
  admin: 'Admins',
  editor: 'Editors',
  viewer: 'Viewers',
  guest: 'Guests',
};

function denial(code: ErrorCode, message: string, details?: Record<string, unknown>): Denial {
  return { code, message, ...(details ? { details } : {}) };
}

export function can(actor: Actor, action: Action, resource: Resource): Decision {
  // --- API key gates -------------------------------------------------------
  if (actor.apiKey) {
    if (actor.role === 'guest') {
      return denial(
        'GUEST_API_DENIED',
        'Guest accounts cannot use the API. Guest access is limited to the app, where their ' +
          'field restrictions are applied.',
      );
    }
    const needed: ApiKeyScope = ADMIN_ACTIONS.has(action)
      ? 'admin'
      : WRITE_ACTIONS.has(action)
        ? 'write'
        : 'read';
    if (!hasScope(actor.apiKey.scopes, needed)) {
      return denial('FORBIDDEN', `This API key does not have "${needed}" scope.`, {
        required: needed,
        granted: actor.apiKey.scopes,
      });
    }
  }

  // --- role matrix ---------------------------------------------------------
  if (!ROLE_MATRIX[actor.role].has(action)) {
    return denial('FORBIDDEN', roleDenialMessage(actor.role, action));
  }

  // --- per-resource refinements -------------------------------------------
  if (actor.role === 'guest') {
    const guestDecision = checkGuest(actor, action, resource);
    if (guestDecision !== true) return guestDecision;
  }

  if (resource.kind === 'view') {
    return checkView(actor, action, resource);
  }

  if (resource.kind === 'change_set' && action === 'change_set.undo') {
    // Undoing someone else's bulk edit is an admin act: the person who made it
    // may still be mid-task, and the undo is itself a workspace-wide write.
    const isOwnChange = resource.actorId != null && resource.actorId === actor.userId;
    if (!isOwnChange && actor.role !== 'owner' && actor.role !== 'admin') {
      return denial(
        'FORBIDDEN',
        'You can only undo changes you made. Ask an admin to undo someone else’s change.',
      );
    }
  }

  return true;
}

function hasScope(granted: readonly ApiKeyScope[], needed: ApiKeyScope): boolean {
  if (granted.includes('admin')) return true;
  if (needed === 'read') return granted.includes('read') || granted.includes('write');
  return granted.includes(needed);
}

function roleDenialMessage(role: MemberRole, action: Action): string {
  const [subject] = action.split('.');
  switch (role) {
    case 'viewer':
      return `Viewers have read-only access. Ask an admin to make you an editor to change ${subject?.replace('_', ' ')}s.`;
    case 'editor':
      if (action.startsWith('item_type.') || action.startsWith('field.')) {
        return 'Only admins can change item types and fields — they affect everyone’s views.';
      }
      if (action.startsWith('tree.') || action.startsWith('tree_node.')) {
        return 'Only admins can change the category trees. You can still file items into them.';
      }
      if (action.startsWith('api_key.') || action.startsWith('webhook.')) {
        return 'Only admins can manage API keys and webhooks.';
      }
      return `Editors cannot ${action.replace('.', ' ')}.`;
    case 'guest':
      return 'Guests can only view and edit the items shared with them.';
    case 'admin':
      return 'Only the workspace owner can do that.';
    default:
      return `${ROLE_LABEL[role]} cannot ${action.replace('.', ' ')}.`;
  }
}

/**
 * Guest scoping.
 *
 * A guest sees an item only if it belongs to a tree node inside their scope.
 * The check is on ltree paths so an item filed three levels under the granted
 * node is included when `includeDescendants` is set — which is what a client
 * expects when they are given "the Acme branch".
 *
 * The caller must pass `treeNodePaths`. Omitting them is a programming error,
 * not a permissive default: defaulting to "allow" here would hand a guest the
 * whole workspace the first time someone forgot to load memberships.
 */
function checkGuest(actor: Actor, action: Action, resource: Resource): Decision {
  const scopes = actor.guestScopes ?? [];
  if (scopes.length === 0) {
    return denial('OUT_OF_SCOPE', 'Nothing has been shared with you in this workspace yet.');
  }

  if (resource.kind !== 'item') {
    // Non-item reads (types, trees, views) are needed to render the shell.
    return true;
  }

  const paths = resource.treeNodePaths;
  if (paths === undefined) {
    throw new AppError(
      'INTERNAL',
      'Guest permission check requires the item’s tree node paths. Load them before calling can().',
    );
  }

  const matching = scopes.filter((scope) =>
    paths.some((path) =>
      scope.includeDescendants ? isAtOrBelow(path, scope.treeNodePath) : path === scope.treeNodePath,
    ),
  );

  if (matching.length === 0) {
    return denial('OUT_OF_SCOPE', 'That item is outside the area shared with you.');
  }

  if (action === 'item.read') return true;

  if (action === 'item.update') {
    const editable = matching.filter((s) => s.canEdit);
    if (editable.length === 0) {
      return denial('OUT_OF_SCOPE', 'You have view-only access to this item.');
    }

    const keys = resource.fieldKeys ?? [];
    // A null allowlist means "every field on in-scope items".
    const unrestricted = editable.some((s) => s.editableFieldKeys === null);
    if (unrestricted) return true;

    const allowed = new Set(editable.flatMap((s) => s.editableFieldKeys ?? []));
    const blocked = keys.filter((k) => !allowed.has(k));
    if (blocked.length > 0) {
      return denial('OUT_OF_SCOPE', `You can’t edit ${blocked.join(', ')} on shared items.`, {
        blockedFields: blocked,
        allowedFields: [...allowed],
      });
    }
    return true;
  }

  return denial('FORBIDDEN', 'Guests can only view and edit the items shared with them.');
}

function checkView(
  actor: Actor,
  action: Action,
  resource: Extract<Resource, { kind: 'view' }>,
): Decision {
  const isOwner = resource.ownerId != null && resource.ownerId === actor.userId;
  const isPrivate = resource.visibility === 'private';

  if (isPrivate && !isOwner && resource.ownerId !== undefined) {
    // A private view is personal. Admins do not get to read one either; it is
    // a saved filter, not a governance artefact.
    return denial('NOT_FOUND', 'That view no longer exists.');
  }

  if ((action === 'view.update' || action === 'view.delete') && !isOwner) {
    if (actor.role !== 'owner' && actor.role !== 'admin') {
      return denial(
        'FORBIDDEN',
        'Only the person who made this view, or an admin, can change it. You can duplicate it instead.',
      );
    }
  }

  return true;
}

/** Throws `AppError` on denial. The form route handlers should use. */
export function assertCan(actor: Actor, action: Action, resource: Resource): void {
  const decision = can(actor, action, resource);
  if (decision !== true) {
    throw new AppError(decision.code, decision.message, decision.details);
  }
}

/**
 * Which of a guest's granted field keys apply to an item, for rendering.
 * Returns `null` when every field is editable.
 */
export function editableFieldKeysFor(
  actor: Actor,
  treeNodePaths: readonly string[],
): string[] | null {
  if (actor.role !== 'guest') return null;
  const matching = (actor.guestScopes ?? []).filter(
    (scope) =>
      scope.canEdit &&
      treeNodePaths.some((path) =>
        scope.includeDescendants
          ? isAtOrBelow(path, scope.treeNodePath)
          : path === scope.treeNodePath,
      ),
  );
  if (matching.length === 0) return [];
  if (matching.some((s) => s.editableFieldKeys === null)) return null;
  return [...new Set(matching.flatMap((s) => s.editableFieldKeys ?? []))];
}

export const PERMISSION_MATRIX = ROLE_MATRIX;
