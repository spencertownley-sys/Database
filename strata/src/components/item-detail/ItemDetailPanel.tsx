'use client';

/**
 * The item detail panel (UI/UX §3.5) — the full picture of one item,
 * including everything the grid cannot show: field groups, the completeness
 * breakdown with click-to-focus links, hierarchy breadcrumb, tree chips, the
 * variant banner, and the activity feed.
 *
 * Every value edits in place; there is no edit-mode toggle. Writes go through
 * `PATCH /items/:id`, which is a change set underneath — a panel edit undoes
 * exactly like a grid edit.
 *
 * Inherited variant values are marked through **two channels** — muted color
 * *and* the ⟲ glyph — never color alone (UI/UX §3.5); overrides get the amber
 * left bar and a one-click revert.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, X } from 'lucide-react';
import type { Field, FieldGroup } from '@/server/db/schema/itemTypes';
import { api, ApiError, type ItemDetail } from '@/lib/api';
import { formatValue } from '@/server/validation/fieldTypes';
import type { SelectOption } from '@/types/fields';
import { CompletenessBar } from './CompletenessBar';
import type { WorkspaceMemberOption } from '@/components/grid/editors/UserEditor';

export interface ItemDetailPanelProps {
  itemId: string;
  fields: Field[];
  fieldGroups: FieldGroup[];
  members: WorkspaceMemberOption[];
  /** Rendered full-page (deep link) instead of as a side panel. */
  fullPage?: boolean;
  onClose?: () => void;
  onDataChanged?: () => void;
}

export function ItemDetailPanel(props: ItemDetailPanelProps) {
  const queryClient = useQueryClient();
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(props.fieldGroups.filter((g) => g.collapsedByDefault).map((g) => g.id)),
  );
  const [error, setError] = useState<string | null>(null);
  const fieldRefs = useRef(new Map<string, HTMLElement>());

  const queryKey = ['item-detail', props.itemId];
  const { data: item, isLoading } = useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      api.items.get(props.itemId, ['item_type', 'ancestors', 'children', 'tree_nodes'], signal),
  });

  const { data: activity } = useQuery({
    queryKey: ['item-activity', props.itemId],
    queryFn: ({ signal }) => api.activity.list({ itemId: props.itemId, limit: 15 }, signal),
  });

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['item-detail', props.itemId] });
    void queryClient.invalidateQueries({ queryKey: ['item-activity', props.itemId] });
    props.onDataChanged?.();
  }, [props, queryClient]);

  const patch = useCallback(
    async (body: Parameters<typeof api.items.patch>[1]) => {
      setError(null);
      try {
        await api.items.patch(props.itemId, body);
        refresh();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'That change could not be saved.');
      }
    },
    [props.itemId, refresh],
  );

  useEffect(() => {
    if (props.fullPage || !props.onClose) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  const focusField = (key: string) => {
    const el = fieldRefs.current.get(key);
    el?.scrollIntoView({ block: 'center' });
    el?.querySelector<HTMLElement>('input,select,textarea,button')?.focus();
  };

  const grouped = groupFields(props.fields, props.fieldGroups);
  const fieldByKey = new Map(props.fields.map((f) => [f.key, f]));

  const body = (
    <div
      className={
        props.fullPage
          ? 'mx-auto h-full w-full max-w-2xl overflow-y-auto bg-[var(--color-surface)]'
          : 'flex h-full w-[480px] max-w-full flex-col overflow-y-auto border-l bg-[var(--color-surface)] shadow-lg'
      }
      role={props.fullPage ? undefined : 'dialog'}
      aria-label={item ? `${item.title} details` : 'Item details'}
    >
      {isLoading || !item ? (
        <p className="p-6 text-sm text-[var(--color-ink-subtle)]">
          {isLoading ? 'Loading…' : 'This item no longer exists.'}
        </p>
      ) : (
        <>
          <header className="sticky top-0 z-10 border-b bg-[var(--color-surface)] px-4 py-3">
            <div className="flex items-start gap-2">
              <TitleEditor title={item.title} onCommit={(title) => void patch({ title })} />
              {props.onClose && (
                <button
                  type="button"
                  aria-label="Close details"
                  className="rounded p-1 text-[var(--color-ink-subtle)] hover:bg-[var(--color-muted)]"
                  onClick={props.onClose}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="mt-1 truncate text-xs text-[var(--color-ink-muted)]">
              {item.itemType?.label}
              {item.ancestors?.length ? (
                <> · {item.ancestors.map((a) => a.title).join(' › ')}</>
              ) : null}
            </p>
          </header>

          {error && (
            <p role="alert" className="border-b bg-[var(--color-danger-soft)] px-4 py-2 text-xs text-[var(--color-danger)]">
              {error}
            </p>
          )}

          <section className="border-b px-4 py-3" aria-label="Completeness">
            <CompletenessBar pct={item.completenessPct} />
            {item.missingRequired.length > 0 && (
              <p className="mt-1.5 text-xs text-[var(--color-ink-muted)]">
                Missing:{' '}
                {item.missingRequired.map((key, i) => (
                  <span key={key}>
                    {i > 0 && ' · '}
                    <button
                      type="button"
                      className="underline underline-offset-2 hover:text-[var(--color-ink)]"
                      onClick={() => focusField(key)}
                    >
                      {fieldByKey.get(key)?.label ?? key}
                    </button>
                  </span>
                ))}
              </p>
            )}
          </section>

          {item.treeNodes && item.treeNodes.length > 0 && (
            <section className="flex flex-wrap gap-1.5 border-b px-4 py-3" aria-label="Categories">
              {item.treeNodes.map((node) => (
                <span
                  key={node.id}
                  className="rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs"
                >
                  {node.label}
                </span>
              ))}
            </section>
          )}

          {item.variantInfo && (
            <section
              className="border-b border-l-2 border-l-[var(--color-warning)] bg-[var(--color-warning-soft)] px-4 py-3 text-xs"
              aria-label="Variant relationship"
            >
              <p className="font-medium">⟲ Variant of “{item.variantInfo.variantParentTitle}”</p>
              <p className="mt-0.5 text-[var(--color-ink-muted)]">
                {Object.entries(item.variantInfo.axisValues)
                  .map(([k, v]) => `${fieldByKey.get(k)?.label ?? k}: ${v}`)
                  .join(' · ')}
              </p>
              <p className="mt-0.5 text-[var(--color-ink-muted)]">
                {item.variantInfo.inheritedFields.length} fields inherited ·{' '}
                {item.variantInfo.overriddenFields.length} overridden
              </p>
            </section>
          )}

          {grouped.map(({ group, fields }) => (
            <section key={group?.id ?? 'default'} className="border-b px-4 py-3">
              {group && (
                <button
                  type="button"
                  className="mb-2 flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]"
                  aria-expanded={!collapsedGroups.has(group.id)}
                  onClick={() =>
                    setCollapsedGroups((current) => {
                      const next = new Set(current);
                      if (next.has(group.id)) next.delete(group.id);
                      else next.add(group.id);
                      return next;
                    })
                  }
                >
                  <span aria-hidden>{collapsedGroups.has(group.id) ? '▸' : '⌄'}</span>
                  {group.label}
                </button>
              )}
              {(!group || !collapsedGroups.has(group.id)) &&
                fields.map((field) => (
                  <FieldRow
                    key={field.key}
                    field={field}
                    item={item}
                    members={props.members}
                    refCallback={(el) => {
                      if (el) fieldRefs.current.set(field.key, el);
                    }}
                    onCommit={(value) => void patch({ values: { [field.key]: value } })}
                    onRevert={() => void patch({ revertFields: [field.key] })}
                  />
                ))}
            </section>
          ))}

          {item.children && item.children.length > 0 && (
            <section className="border-b px-4 py-3" aria-label="Sub-items">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                Sub-items ({item.children.length})
              </h3>
              {item.children.map((child) => (
                <div key={child.id} className="flex items-center gap-3 py-1 text-sm">
                  <span className="min-w-0 flex-1 truncate">{child.title}</span>
                  <span className="w-24">
                    <CompletenessBar pct={child.completenessPct} compact />
                  </span>
                </div>
              ))}
            </section>
          )}

          <section className="px-4 py-3" aria-label="Activity">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              Activity
            </h3>
            {(activity?.data ?? []).length === 0 ? (
              <p className="text-xs text-[var(--color-ink-subtle)]">No changes recorded yet.</p>
            ) : (
              activity?.data.map((entry) => (
                <p key={entry.id} className="py-1 text-xs text-[var(--color-ink-muted)]">
                  <span className="font-medium text-[var(--color-ink)]">
                    {entry.actorName ?? 'Someone'}
                  </span>{' '}
                  {describeActivity(entry.operation, entry.itemCount)}
                  {entry.undoneByChangeSetId ? ' (undone)' : ''}
                  <span className="text-[var(--color-ink-subtle)]">
                    {' '}
                    · {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </p>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );

  if (props.fullPage) return body;
  return <div className="absolute inset-y-0 right-0 z-40 flex">{body}</div>;
}

function TitleEditor({ title, onCommit }: { title: string; onCommit: (title: string) => void }) {
  const [draft, setDraft] = useState(title);
  useEffect(() => setDraft(title), [title]);
  return (
    <input
      className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-base font-semibold outline-none hover:border-[var(--color-border)] focus:border-[var(--color-accent)]"
      value={draft}
      aria-label="Item title"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() && draft !== title && onCommit(draft.trim())}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(title);
      }}
    />
  );
}

function FieldRow({
  field,
  item,
  members,
  refCallback,
  onCommit,
  onRevert,
}: {
  field: Field;
  item: ItemDetail;
  members: WorkspaceMemberOption[];
  refCallback: (el: HTMLElement | null) => void;
  onCommit: (value: unknown) => void;
  onRevert: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const info = item.variantInfo;
  const isAxis = info ? field.key in info.axisValues : false;
  const inherited = info ? info.inheritedFields.includes(field.key) : false;
  const overridden = info ? info.overriddenFields.includes(field.key) : false;
  const readOnly = Boolean(info) && field.inheritance === 'shared' && !isAxis;

  const value = item.effectiveValues[field.key];
  const invalid = (item.invalidValues as Record<string, { raw?: unknown; message?: string }>)[
    field.key
  ];
  const formatted = invalid ? String(invalid.raw ?? '') : formatValue(field.type, value, field.config);

  const commitDraft = () => {
    setEditing(false);
    onCommit(draft === '' ? null : draft);
  };

  const options = (field.config as { options?: SelectOption[] }).options;

  return (
    <div
      ref={refCallback}
      className={`flex min-h-8 items-start gap-3 py-1 text-sm ${
        overridden ? 'border-l-2 border-l-[var(--color-warning)] pl-2' : ''
      }`}
    >
      <span className="w-32 shrink-0 pt-0.5 text-xs text-[var(--color-ink-muted)]" title={field.helpText ?? undefined}>
        {field.label}
        {field.requiredForCompleteness && (
          <span className="ml-1 rounded bg-[var(--color-muted)] px-1 text-[10px] uppercase">
            Required
          </span>
        )}
      </span>

      <span className="min-w-0 flex-1">
        {readOnly ? (
          <span
            className="text-[var(--color-ink-muted)]"
            title={`Shared from ${info?.variantParentTitle ?? 'the model'} — edit the model to change it everywhere.`}
          >
            <span aria-hidden className="mr-1 text-[var(--color-warning)]">⟲</span>
            <span className="sr-only">Inherited from {info?.variantParentTitle}: </span>
            {formatted || '—'}
          </span>
        ) : editing ? (
          field.type === 'select' && options ? (
            <select
              autoFocus
              className="w-full rounded border border-[var(--color-accent)] px-1.5 py-0.5 text-sm outline-none"
              defaultValue={typeof value === 'string' ? value : ''}
              onChange={(e) => {
                setEditing(false);
                onCommit(e.target.value || null);
              }}
              onBlur={() => setEditing(false)}
            >
              <option value="">—</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : field.type === 'user' ? (
            <select
              autoFocus
              className="w-full rounded border border-[var(--color-accent)] px-1.5 py-0.5 text-sm outline-none"
              defaultValue={typeof value === 'string' ? value : ''}
              onChange={(e) => {
                setEditing(false);
                onCommit(e.target.value || null);
              }}
              onBlur={() => setEditing(false)}
            >
              <option value="">—</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name ?? m.email}
                </option>
              ))}
            </select>
          ) : (
            <input
              autoFocus
              className="w-full rounded border border-[var(--color-accent)] px-1.5 py-0.5 text-sm outline-none"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitDraft();
                if (e.key === 'Escape') setEditing(false);
              }}
            />
          )
        ) : field.type === 'checkbox' ? (
          <input
            type="checkbox"
            checked={value === true}
            aria-label={field.label}
            onChange={(e) => onCommit(e.target.checked)}
          />
        ) : (
          <button
            type="button"
            className={`w-full truncate rounded px-1 py-0.5 text-left hover:bg-[var(--color-muted)] ${
              inherited && !isAxis ? 'text-[var(--color-ink-muted)]' : ''
            } ${invalid ? 'text-[var(--color-danger)]' : ''}`}
            title={
              invalid?.message ??
              (inherited && !isAxis ? `Inherited from ${info?.variantParentTitle}` : undefined)
            }
            onClick={() => {
              setDraft(formatted);
              setEditing(true);
            }}
          >
            {inherited && !isAxis && (
              <span aria-hidden className="mr-1 text-[var(--color-warning)]">⟲</span>
            )}
            {formatted || <span className="text-[var(--color-ink-subtle)]">—</span>}
          </button>
        )}
      </span>

      {overridden && (
        <button
          type="button"
          className="mt-0.5 shrink-0 rounded p-0.5 text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)]"
          title="Revert to inherited"
          aria-label={`Revert ${field.label} to inherited`}
          onClick={onRevert}
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function groupFields(
  fields: readonly Field[],
  groups: readonly FieldGroup[],
): Array<{ group: FieldGroup | null; fields: Field[] }> {
  const byGroup = new Map<string | null, Field[]>();
  for (const field of fields) {
    const key = field.fieldGroupId ?? null;
    const list = byGroup.get(key);
    if (list) list.push(field);
    else byGroup.set(key, [field]);
  }

  const out: Array<{ group: FieldGroup | null; fields: Field[] }> = [];
  const ungrouped = byGroup.get(null);
  if (ungrouped) out.push({ group: null, fields: ungrouped });
  for (const group of groups) {
    const list = byGroup.get(group.id);
    if (list) out.push({ group, fields: list });
  }
  return out;
}

function describeActivity(operation: string, itemCount: number): string {
  const plural = itemCount === 1 ? 'this item' : `${itemCount} items`;
  switch (operation) {
    case 'create':
      return `created ${plural}`;
    case 'set_field':
      return `edited ${plural}`;
    case 'clear_field':
      return `cleared fields on ${plural}`;
    case 'delete':
      return `archived ${plural}`;
    case 'reparent':
      return `moved ${plural}`;
    case 'tree_assign':
      return `filed ${plural}`;
    case 'tree_unassign':
      return `unfiled ${plural}`;
    case 'assign_user':
      return `reassigned ${plural}`;
    case 'variant_propagate':
      return `propagated shared fields to ${plural}`;
    default:
      return `changed ${plural}`;
  }
}
