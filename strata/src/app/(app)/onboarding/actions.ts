'use server';

import { redirect } from 'next/navigation';
import { requireSessionUser } from '@/server/auth/session';
import { bootstrapWorkspace } from '@/server/services/workspaces.service';
import { AppError } from '@/server/lib/errors';

export async function createWorkspaceAction(
  _prev: { error: string | null },
  formData: FormData,
): Promise<{ error: string | null }> {
  const name = String(formData.get('name') ?? '');

  let slug: string;
  try {
    const user = await requireSessionUser();
    const workspace = await bootstrapWorkspace(user.id, name);
    slug = workspace.slug;
  } catch (e) {
    return { error: e instanceof AppError ? e.message : 'That workspace could not be created.' };
  }

  redirect(`/w/${slug}`);
}
