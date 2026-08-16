/**
 * Workspace discovery and first-login bootstrap.
 *
 * Two things this file exists for, both because `workspaces` sits just
 * outside the RLS boundary that everything else in the app lives inside:
 *
 *  1. **Discovery.** "Which workspaces does this user belong to" has to run
 *     *before* any workspace is pinned, but `workspace_members` is RLS-scoped
 *     like every tenant table — an unpinned read from the app role correctly
 *     returns nothing. Same bootstrap trap as API-key and share-token
 *     resolution, same fix: a narrow SECURITY DEFINER lookup
 *     (`app_list_user_workspaces`, migration 0011).
 *
 *  2. **Bootstrap.** `workspaces` itself carries no RLS policy — it is
 *     filtered by membership in the middleware instead, because resolving
 *     the slug has to happen before a workspace context exists. So creating
 *     one is a plain insert; every child row (the owner's membership, the
 *     starter item type, the built-in tree) needs the new id pinned via
 *     `withWorkspace` first, or their `WITH CHECK` policies reject the
 *     insert outright.
 */

import { eq, sql } from 'drizzle-orm';
import { db, withWorkspace, withoutWorkspace, type Tx } from '@/server/db';
import { workspaces, workspaceMembers, type Workspace } from '@/server/db/schema/workspaces';
import { trees } from '@/server/db/schema/trees';
import { AppError } from '@/server/lib/errors';
import { createItemTypeFromPreset } from './itemTypes.service';

export interface UserWorkspaceMembership {
  workspaceId: string;
  slug: string;
  name: string;
  role: string;
}

export async function listWorkspacesForUser(userId: string): Promise<UserWorkspaceMembership[]> {
  return withoutWorkspace(async (tx) => {
    const rows = await tx.execute(sql`select * from app_list_user_workspaces(${userId}::uuid)`);
    return [...rows].map((r) => {
      const row = r as Record<string, unknown>;
      return {
        workspaceId: row.workspace_id as string,
        slug: row.slug as string,
        name: row.name as string,
        role: row.role as string,
      };
    });
  });
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || 'workspace';
}

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  let n = 1;
  for (;;) {
    const [existing] = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, candidate))
      .limit(1);
    if (!existing) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
}

/**
 * First-login bootstrap: a workspace, its owner membership, one starter item
 * type (Task, from the same preset the builder and seed script use — a
 * bootstrapped workspace and a hand-built one produce identical schemas),
 * and the built-in category tree.
 */
export async function bootstrapWorkspace(ownerId: string, name: string): Promise<Workspace> {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'Give the workspace a name.');
  }
  const slug = await uniqueSlug(slugify(trimmed));

  const [workspace] = await db
    .insert(workspaces)
    .values({ slug, name: trimmed, plan: 'free' })
    .returning();
  if (!workspace) throw new AppError('INTERNAL_ERROR', 'The workspace was not created.');

  await withWorkspace(workspace.id, async (tx: Tx) => {
    await tx.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: ownerId,
      role: 'owner',
      status: 'active',
      acceptedAt: new Date(),
    });

    await createItemTypeFromPreset(tx, workspace.id, 'task', ownerId);

    await tx.insert(trees).values({
      workspaceId: workspace.id,
      key: 'categories',
      label: 'Categories',
      description: 'Classify items without moving them.',
      isBuiltIn: true,
      icon: 'folder',
    });
  });

  return workspace;
}
