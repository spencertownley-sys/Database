import { and, eq, isNull } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { withoutWorkspace, withWorkspace } from '@/server/db';
import { fields as fieldsTable } from '@/server/db/schema/itemTypes';
import { resolveShareToken } from '@/server/services/views.service';
import { searchProvider } from '@/server/search/PostgresSearchProvider';
import { formatValue } from '@/server/validation/fieldTypes';
import type { Field } from '@/server/db/schema/itemTypes';

export const dynamic = 'force-dynamic';

/**
 * The public shared view (API Design §7, UI/UX §3.10) — **read-only and
 * unauthenticated by construction**. There is no session, no member row, and
 * no write surface on this page; an anonymous visitor gets exactly the rows
 * and columns the view's config names, rendered server-side, and nothing
 * else. A guest who needs to edit signs in through their invite instead.
 */
export default async function SharedViewPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const shared = await withoutWorkspace((tx) => resolveShareToken(tx, token));
  if (!shared) notFound();

  const { items, columns } = await withWorkspace(shared.workspaceId, async (tx) => {
    const liveFields = await tx
      .select()
      .from(fieldsTable)
      .where(
        and(
          eq(fieldsTable.workspaceId, shared.workspaceId),
          eq(fieldsTable.itemTypeId, shared.itemTypeId),
          isNull(fieldsTable.deletedAt),
        ),
      );

    const byKey = new Map(liveFields.map((f) => [f.key, f]));
    const visible: Field[] = shared.config.visibleFieldKeys?.length
      ? shared.config.visibleFieldKeys
          .map((key) => byKey.get(key))
          .filter((f): f is Field => Boolean(f))
      : [...liveFields].sort((a, b) => a.position.localeCompare(b.position)).slice(0, 8);

    const page = await searchProvider.search(tx, shared.workspaceId, liveFields, {
      itemTypeId: shared.itemTypeId,
      filter: shared.config.filter,
      sort: shared.config.sort,
      search: shared.config.search,
      incompleteOnly: shared.config.incompleteOnly,
      treeNodeId: shared.config.treeNodeId,
      treeIncludeDescendants: shared.config.treeIncludeDescendants ?? true,
      includeVariants: true,
      limit: 500,
    });

    return { items: page.items, columns: visible };
  });

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-5">
        <h1 className="text-xl font-semibold">{shared.name}</h1>
        {shared.description && (
          <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{shared.description}</p>
        )}
        <p className="mt-1 text-xs text-[var(--color-ink-subtle)]">
          Shared read-only view · {items.length} item{items.length === 1 ? '' : 's'} · powered by
          Strata
        </p>
      </header>

      <div className="overflow-x-auto rounded-[var(--radius-lg)] border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-[var(--color-muted)] text-left text-xs uppercase tracking-wide text-[var(--color-ink-muted)]">
              <th className="px-3 py-2 font-medium">Title</th>
              {columns.map((field) => (
                <th key={field.key} className="px-3 py-2 font-medium">
                  {field.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b last:border-b-0">
                <td className="px-3 py-1.5 font-medium">{item.title}</td>
                {columns.map((field) => {
                  const value = (item.effectiveValues as Record<string, unknown>)[field.key];
                  return (
                    <td key={field.key} className="px-3 py-1.5 text-[var(--color-ink-muted)]">
                      {value === null || value === undefined
                        ? ''
                        : formatValue(field.type, value, field.config)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-sm text-[var(--color-ink-subtle)]">
                  Nothing matches this view right now.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
