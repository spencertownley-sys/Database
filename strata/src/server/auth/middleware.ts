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

/**
 * Resolves the caller for a `/api/v1` request.
 *
 * `slug` may be omitted when the key itself identifies the workspace — an API
 * key is minted against one workspace and cannot address another, so the key
 * is the stronger scoping signal and wins if both are present and disagree.
 */
export async function resolveRequestContext(
  request: Request,
  slug: string | undefined,
  limitKind: LimitKind = 'read',
): Promise<RequestContext> {
  const token = bearerToken(request);

  if (token && looksLikeApiKey(token)) {
    const identity = await resolveApiKey(token);
    const workspace = await loadWorkspaceById(identity.workspaceId);

    if (slug && workspace.slug !== slug) {
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
  if (!user) throw new AppError('UNAUTHENTICATED', 'Sign in to continue.');
  if (!slug) throw new AppError('WORKSPACE_NOT_FOUND', 'No workspace was specified.');

  const context = await resolveSessionContext(user, slug);
  const rateLimit = await checkRateLimit(limitKind, `user:${user.id}:${context.workspace.id}`);
  assertWithinLimit(rateLimit);

  return { ...context, rateLimit };
}

/** The page/server-action path: session only, no API keys. */
export async function resolveSessionContext(
  user: SessionUser,
  slug: string,
): Promise<{ user: SessionUser; workspace: Workspace; actor: Actor }> {
  const workspace = await loadWorkspaceBySlug(slug);

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
    throw new AppError('WORKSPACE_NOT_FOUND', 'That workspace does not exist, or you do not have access.');
  }
  if (membership.status === 'pending') {
    throw new AppError('NOT_A_MEMBER', 'Accept your invitation to open this workspace.');
  }
  if (membership.status === 'suspended') {
    throw new AppError('NOT_A_MEMBER', 'Your access to this workspace has been suspended.');
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
    throw new AppError('WORKSPACE_NOT_FOUND', 'That workspace does not exist, or you do not have access.');
  }
  return workspace;
}

async function loadWorkspaceById(id: string): Promise<Workspace> {
  const workspace = await withoutWorkspace(async (tx) => {
    const rows = await tx.select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
    return rows[0] ?? null;
  });
  if (!workspace) throw new AppError('WORKSPACE_NOT_FOUND', 'That workspace no longer exists.');
  return workspace;
}

function assertWithinLimit(result: RateLimitResult): void {
  if (result.allowed) return;
  const seconds = Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1000));
  throw new AppError('RATE_LIMITED', `Too many requests. Try again in ${seconds}s.`, {
    retryAfterSeconds: seconds,
  });
}
