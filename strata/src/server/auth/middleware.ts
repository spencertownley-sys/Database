/**
 * The request chain: authenticate → resolve workspace → verify membership →
 * attach the actor → rate limit.
 *
 * Every authenticated entry point — App Router page, server action, and
 * `/api/v1` route alike — goes through `resolveRequestContext`. Two paths into
 * the same data with two different membership checks is how one of them ends
 * up missing a check.
 */

import { and, eq, sql } from 'drizzle-orm';
import { withWorkspace, withoutWorkspace } from '@/server/db';
import { guestScopes, workspaceMembers, workspaces, type Workspace } from '@/server/db/schema/workspaces';
import { treeNodes } from '@/server/db/schema/trees';
import { AppError } from '@/server/lib/errors';
import { checkRateLimit, type LimitKind, type RateLimitResult } from '@/server/lib/ratelimit';
import type { Actor, GuestScopeSummary } from '@/server/services/permissions.service';
import { getSessionUser, type SessionUser } from './session';
import { looksLikeApiKey, resolveApiKey } from './apiKeys';

export interface RequestContext {
  user: SessionUser | null;
  workspace: Workspace;
  actor: Actor;
  rateLimit?: RateLimitResult;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || !value) return null;
  if (scheme.toLowerCase() !== 'bearer') return null;
  return value.trim();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the caller for a `/api/v1` request.
 *
 * `workspaceId` is the `X-Workspace-Id` header (API Design §1.1). It may be
 * omitted only when an API key identifies the workspace — a key is minted
 * against one workspace and cannot address another, so the key is the
 * stronger scoping signal and wins if both are present and disagree. A
 * session request without the header is rejected with `WORKSPACE_REQUIRED`:
 * there is no default-workspace fallback, because an implicit tenant is how
 * cross-tenant bugs happen.
 */
export async function resolveRequestContext(
  request: Request,
  workspaceId: string | undefined,
  limitKind: LimitKind = 'read',
): Promise<RequestContext> {
  const token = bearerToken(request);

  if (token && looksLikeApiKey(token)) {
    const identity = await resolveApiKey(token);
    const workspace = await loadWorkspaceById(identity.workspaceId);

    if (workspaceId && workspace.id !== workspaceId) {
      throw new AppError(
        'FORBIDDEN',
        'This API key belongs to a different workspace.',
      );
    }

    const rateLimit = await checkRateLimit(limitKind, `key:${identity.apiKeyId}`);
    assertWithinLimit(rateLimit);

    return {
      user: null,
      workspace,
      actor: {
        userId: identity.userId,
        workspaceId: workspace.id,
        memberId: identity.memberId,
        role: identity.role,
        apiKey: { id: identity.apiKeyId, scopes: identity.scopes },
      },
      rateLimit,
    };
  }

  const user = await getSessionUser();
  if (!user) throw new AppError('UNAUTHORIZED', 'Sign in to continue.');
  if (!workspaceId) {
    throw new AppError(
      'WORKSPACE_REQUIRED',
      'Send the workspace id in the X-Workspace-Id header.',
    );
  }
  if (!UUID_RE.test(workspaceId)) {
    throw new AppError(
      'WORKSPACE_REQUIRED',
      'X-Workspace-Id must be a workspace id (uuid), not a slug.',
    );
  }

  const workspace = await loadWorkspaceById(workspaceId).catch(() => {
    // Same shape as a membership miss: confirming that a workspace id exists
    // to a non-member leaks the customer list.
    throw new AppError('NOT_FOUND', 'That workspace does not exist, or you do not have access.');
  });
  const context = await resolveMembershipContext(user, workspace);
  const rateLimit = await checkRateLimit(limitKind, `user:${user.id}:${context.workspace.id}`);
  assertWithinLimit(rateLimit);

  return { ...context, rateLimit };
}

/** The page/server-action path: session only, addressed by URL slug. */
export async function resolveSessionContext(
  user: SessionUser,
  slug: string,
): Promise<{ user: SessionUser; workspace: Workspace; actor: Actor }> {
  const workspace = await loadWorkspaceBySlug(slug);
  return resolveMembershipContext(user, workspace);
}

async function resolveMembershipContext(
  user: SessionUser,
  workspace: Workspace,
): Promise<{ user: SessionUser; workspace: Workspace; actor: Actor }> {
  // `workspace_members` is a tenant table, so this must run *inside* the
  // workspace context. Reading it through `withoutWorkspace` returns zero rows
  // — RLS fails closed — and a legitimate owner is told they have no access.
  // Resolving the slug first is what makes the context available to pin here.
  const membership = await withWorkspace(workspace.id, async (tx) => {
    const rows = await tx
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspace.id),
          eq(workspaceMembers.userId, user.id),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  });

  if (!membership) {
    // Deliberately the same message a missing workspace gets: telling a
    // non-member that a workspace exists at this slug leaks the customer list.
    throw new AppError('NOT_FOUND', 'That workspace does not exist, or you do not have access.');
  }
  if (membership.status === 'pending') {
    throw new AppError('FORBIDDEN', 'Accept your invitation to open this workspace.');
  }
  if (membership.status === 'suspended') {
    throw new AppError('FORBIDDEN', 'Your access to this workspace has been suspended.');
  }

  const actor: Actor = {
    userId: user.id,
    workspaceId: workspace.id,
    memberId: membership.id,
    role: membership.role,
  };

  if (membership.role === 'guest') {
    actor.guestScopes = await loadGuestScopes(workspace.id, membership.id);
  }

  // Best-effort presence, and deliberately not awaited into the critical path
  // of every request beyond this single cheap update.
  await withWorkspace(workspace.id, (tx) =>
    tx
      .update(workspaceMembers)
      .set({ lastSeenAt: new Date() })
      .where(eq(workspaceMembers.id, membership.id)),
  );

  return { user, workspace, actor };
}

async function loadGuestScopes(
  workspaceId: string,
  memberId: string,
): Promise<GuestScopeSummary[]> {
  // `guest_scopes` and `tree_nodes` are both tenant tables.
  return withWorkspace(workspaceId, async (tx) => {
    const rows = await tx
      .select({
        treeNodeId: guestScopes.treeNodeId,
        includeDescendants: guestScopes.includeDescendants,
        canEdit: guestScopes.canEdit,
        editableFieldKeys: guestScopes.editableFieldKeys,
        treeNodePath: treeNodes.path,
      })
      .from(guestScopes)
      .innerJoin(treeNodes, eq(treeNodes.id, guestScopes.treeNodeId))
      .where(
        and(eq(guestScopes.workspaceId, workspaceId), eq(guestScopes.memberId, memberId)),
      );

    return rows.map((row) => ({
      treeNodeId: row.treeNodeId,
      treeNodePath: row.treeNodePath,
      includeDescendants: row.includeDescendants,
      canEdit: row.canEdit,
      editableFieldKeys: row.editableFieldKeys,
    }));
  });
}

async function loadWorkspaceBySlug(slug: string): Promise<Workspace> {
  const workspace = await withoutWorkspace(async (tx) => {
    const rows = await tx
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.slug, slug), sql`${workspaces.deletedAt} is null`))
      .limit(1);
    return rows[0] ?? null;
  });
  if (!workspace) {
    throw new AppError('NOT_FOUND', 'That workspace does not exist, or you do not have access.');
  }
  return workspace;
}

async function loadWorkspaceById(id: string): Promise<Workspace> {
  const workspace = await withoutWorkspace(async (tx) => {
    const rows = await tx.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    return rows[0] ?? null;
  });
  if (!workspace) throw new AppError('NOT_FOUND', 'That workspace no longer exists.');
  return workspace;
}

function assertWithinLimit(result: RateLimitResult): void {
  if (result.allowed) return;
  const seconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  throw new AppError('RATE_LIMITED', `Too many requests. Try again in ${seconds}s.`, {
    retryAfterSeconds: seconds,
  });
}
