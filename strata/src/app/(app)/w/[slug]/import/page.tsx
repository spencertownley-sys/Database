import { notFound } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { withWorkspace } from '@/server/db';
import { fields as fieldsTable } from '@/server/db/schema/itemTypes';
import { getSessionUser } from '@/server/auth/session';
import { resolveSessionContext } from '@/server/auth/middleware';
import { listItemTypes } from '@/server/services/itemTypes.service';
import { ImportWizard } from '@/components/import/ImportWizard';
import { checkDatabaseReadiness } from '@/server/db/readiness';
import { SetupHelp } from '@/components/SetupHelp';

export const dynamic = 'force-dynamic';

/** CSV import wizard (UI/UX §9.5). */
export default async function ImportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  // Pages render in parallel with the layout, so a broken local setup would
  // surface here as a masked Server Component error before the layout's
  // SetupHelp could — every DB-touching page carries its own guard.
  const readiness = await checkDatabaseReadiness();
  if (readiness.state !== 'ready') return <SetupHelp readiness={readiness} />;

  const user = await getSessionUser();
  if (!user) notFound();
  const context = await resolveSessionContext(user, slug);

  const [itemTypes, allFields] = await Promise.all([
    withWorkspace(context.workspace.id, (tx) => listItemTypes(tx, context.workspace.id)),
    withWorkspace(context.workspace.id, (tx) =>
      tx
        .select({
          itemTypeId: fieldsTable.itemTypeId,
          key: fieldsTable.key,
          label: fieldsTable.label,
        })
        .from(fieldsTable)
        .where(and(eq(fieldsTable.workspaceId, context.workspace.id), isNull(fieldsTable.deletedAt))),
    ),
  ]);

  const fieldsByType: Record<string, Array<{ key: string; label: string }>> = {};
  for (const field of allFields) {
    (fieldsByType[field.itemTypeId] ??= []).push({ key: field.key, label: field.label });
  }

  return (
    <ImportWizard
      workspaceId={context.workspace.id}
      itemTypes={itemTypes.map((t) => ({ id: t.id, label: t.label, pluralLabel: t.pluralLabel }))}
      fieldsByType={fieldsByType}
    />
  );
}
