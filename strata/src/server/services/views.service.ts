/**
 * Saved views — a named lens over one item type.
 *
 * Visibility drives everything:
 *   private   — the owner sees it, nobody else, including admins.
 *   workspace — every member sees it.
 *   shared    — workspace-visible *and* reachable anonymously through
 *               `/share/:token`. The token is minted exactly once, on the
 *               transition to `shared`, and destroyed on the way out —
 *               un-sharing must kill the link, not hide the button (🔒 PRD
 *               §9 Risk 3: field subsetting is presentation, not security).
 */

import { randomBytes } from 'node:crypto';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import type { Tx } from '@/server/db';
import { views, type View, type ViewConfig } from '@/server/db/schema/views';
import { AppError } from '@/server/lib/errors';

export type ViewVisibility = 'private' | 'workspace' | 'shared';

export async function listViews(
  tx: Tx,
  workspaceId: string,
  userId: string | null,
  itemTypeId?: string,
): Promise<View[]> {
  return tx
    .select()
    .from(views)
    .where(
      and(
        eq(views.workspaceId, workspaceId),
        itemTypeId ? eq(views.itemTypeId, itemTypeId) : undefined,
        isNull(views.deletedAt),
        // Private views belong to their owner alone.
        or(
          sql`${views.visibility} != 'private'`,
          userId ? eq(views.ownerId, userId) : sql`false`,
        ),
      ),
    )
    .orderBy(asc(views.position), asc(views.createdAt));
}

export async function getView(tx: Tx, workspaceId: string, viewId: string, userId: string | null): Promise<View> {
  const [view] = await tx
    .select()
    .from(views)
    .where(and(eq(views.workspaceId, workspaceId), eq(views.id, viewId), isNull(views.deletedAt)))
    .limit(1);
  if (!view) throw new AppError('NOT_FOUND', 'That view no longer exists.');
  if (view.visibility === 'private' && view.ownerId !== userId) {
    // Indistinguishable from absent — a 403 would confirm it exists.
    throw new AppError('NOT_FOUND', 'That view no longer exists.');
  }
  return view;
}

export async function createView(
  tx: Tx,
  workspaceId: string,
  userId: string | null,
  input: {
    itemTypeId: string;
    name: string;
    type?: 'grid' | 'list' | 'board';
    description?: string;
    visibility?: ViewVisibility;
    config?: ViewConfig;
  },
): Promise<View> {
  const visibility = input.visibility ?? 'private';
  const [created] = await tx
    .insert(views)
    .values({
      workspaceId,
      itemTypeId: input.itemTypeId,
      name: input.name,
      type: input.type ?? 'grid',
      description: input.description ?? null,
      visibility,
      config: input.config ?? {},
      shareToken: visibility === 'shared' ? mintShareToken() : null,
      ownerId: userId,
    })
    .returning();
  if (!created) throw new AppError('INTERNAL_ERROR', 'The view was not created.');
  return created;
}

export async function updateView(
  tx: Tx,
  workspaceId: string,
  userId: string | null,
  viewId: string,
  patch: {
    name?: string;
    description?: string;
    visibility?: ViewVisibility;
    config?: ViewConfig;
  },
): Promise<View> {
  const view = await getView(tx, workspaceId, viewId, userId);

  let shareToken = view.shareToken;
  if (patch.visibility && patch.visibility !== view.visibility) {
    if (patch.visibility === 'shared') {
      shareToken = view.shareToken ?? mintShareToken();
    } else if (view.visibility === 'shared') {
      // Un-sharing revokes the link permanently; re-sharing mints a new one.
      shareToken = null;
    }
  }

  const [updated] = await tx
    .update(views)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
      ...(patch.config !== undefined ? { config: patch.config } : {}),
      shareToken,
      updatedAt: new Date(),
    })
    .where(eq(views.id, view.id))
    .returning();
  if (!updated) throw new AppError('INTERNAL_ERROR', 'The view vanished mid-update.');
  return updated;
}

export async function deleteView(
  tx: Tx,
  workspaceId: string,
  userId: string | null,
  viewId: string,
): Promise<void> {
  const view = await getView(tx, workspaceId, viewId, userId);
  await tx
    .update(views)
    // Soft delete AND revoke: a deleted shared view must not stay reachable
    // through its token.
    .set({ deletedAt: new Date(), shareToken: null, updatedAt: new Date() })
    .where(eq(views.id, view.id));
}

export interface SharedViewResolution {
  viewId: string;
  workspaceId: string;
  itemTypeId: string;
  type: 'grid' | 'list' | 'board';
  name: string;
  description: string | null;
  config: ViewConfig;
}

/**
 * Anonymous lookup for `/share/:token` — no user, no workspace header, so no
 * way to pin RLS first. Goes through the `app_resolve_share_token` SECURITY
 * DEFINER function (migration 0009), which trades exactly one unguessable
 * token for exactly one view row; the caller then pins the returned workspace
 * and reads item data through RLS as normal.
 */
export async function resolveShareToken(
  tx: Tx,
  token: string,
): Promise<SharedViewResolution | null> {
  if (!/^[a-zA-Z0-9_-]{20,64}$/.test(token)) return null;
  const rows = [...(await tx.execute(sql`select * from app_resolve_share_token(${token})`))] as Array<{
    view_id: string;
    workspace_id: string;
    item_type_id: string;
    view_type: 'grid' | 'list' | 'board';
    name: string;
    description: string | null;
    config: ViewConfig;
  }>;
  const row = rows[0];
  if (!row) return null;
  return {
    viewId: row.view_id,
    workspaceId: row.workspace_id,
    itemTypeId: row.item_type_id,
    type: row.view_type,
    name: row.name,
    description: row.description,
    config: row.config ?? {},
  };
}

function mintShareToken(): string {
  return randomBytes(24).toString('base64url');
}
