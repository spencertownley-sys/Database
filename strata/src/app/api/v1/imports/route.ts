import { desc, eq } from 'drizzle-orm';
import { withWorkspace } from '@/server/db';
import { importJobs } from '@/server/db/schema/imports';
import { AppError } from '@/server/lib/errors';
import { handle } from '@/server/lib/route';
import { collection } from '@/lib/wire';
import { assertCan } from '@/server/services/permissions.service';
import { createImportJob } from '@/server/services/imports.service';
import { shapeImportJob } from '@/server/lib/importWire';
import { uuidSchema } from '@/server/validation/schemas';

export const dynamic = 'force-dynamic';

/**
 * `POST /imports` — multipart upload (API Design §8): `file`, `item_type_id`,
 * optional `import_profile_id`. Parses, detects headers, and suggests a
 * mapping in one round trip.
 */
export async function POST(request: Request): Promise<Response> {
  return handle(
    request,
    async ({ context }) => {
      assertCan(context.actor, 'import.create', { kind: 'import' });

      let form: FormData;
      try {
        form = await request.formData();
      } catch {
        throw new AppError('VALIDATION_ERROR', 'Send multipart/form-data with a `file` part.');
      }

      const file = form.get('file');
      if (!(file instanceof File)) {
        throw new AppError('VALIDATION_ERROR', 'The `file` part is required.');
      }
      const itemTypeId = uuidSchema.safeParse(form.get('item_type_id'));
      if (!itemTypeId.success) {
        throw new AppError('VALIDATION_ERROR', '`item_type_id` is required.');
      }
      const profileRaw = form.get('import_profile_id');
      const profileId =
        typeof profileRaw === 'string' && profileRaw !== '' ? profileRaw : null;

      const content = Buffer.from(await file.arrayBuffer());

      return withWorkspace(context.workspace.id, async (tx) => {
        const { job, detectedColumns } = await createImportJob(tx, context.workspace.id, context.actor.userId, {
          itemTypeId: itemTypeId.data,
          profileId,
          fileName: file.name,
          mimeType: file.type || null,
          content,
        });
        return { ...shapeImportJob(job, context.workspace.id), detectedColumns };
      });
    },
    { limit: 'write', status: 201 },
  );
}

/** `GET /imports` — recent jobs, newest first. */
export async function GET(request: Request): Promise<Response> {
  return handle(request, async ({ context }) => {
    assertCan(context.actor, 'import.create', { kind: 'import' });
    return withWorkspace(context.workspace.id, async (tx) => {
      const rows = await tx
        .select()
        .from(importJobs)
        .where(eq(importJobs.workspaceId, context.workspace.id))
        .orderBy(desc(importJobs.createdAt))
        .limit(50);
      return collection(
        rows.map((job) => shapeImportJob(job, context.workspace.id)),
        { cursor: null, hasMore: false, total: rows.length },
      );
    });
  });
}
