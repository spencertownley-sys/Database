'use client';

/**
 * ⌘K — jump to an item, a type, or a saved view (UI/UX §5.1, Step 14).
 *
 * Mounted once in the workspace layout with a global key listener, so it
 * works from every screen — including inside the grid, whose own ⌘K binding
 * dispatches the same event rather than a second implementation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, setWorkspaceId } from '@/lib/api';

export const OPEN_PALETTE_EVENT = 'strata:open-command-palette';

interface PaletteEntry {
  key: string;
  kind: 'item' | 'type' | 'view';
  label: string;
  hint: string;
  href: string;
}

export function CommandPalette(props: {
  workspaceId: string;
  workspaceSlug: string;
  itemTypes: Array<{ id: string; label: string; pluralLabel: string | null }>;
}) {
  setWorkspaceId(props.workspaceId);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery('');
        setSelected(0);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    const onOpenEvent = () => {
      setOpen(true);
      setQuery('');
      setSelected(0);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener(OPEN_PALETTE_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpenEvent);
    };
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const { data: itemResults } = useQuery({
    queryKey: ['palette-items', props.workspaceId, query],
    queryFn: ({ signal }) => api.items.list({ q: query, limit: 6 }, signal),
    enabled: open && query.trim().length >= 2,
  });
  const { data: viewResults } = useQuery({
    queryKey: ['palette-views', props.workspaceId],
    queryFn: ({ signal }) => api.views.list(undefined, signal),
    enabled: open,
  });

  const q = query.trim().toLowerCase();
  const entries: PaletteEntry[] = [
    ...props.itemTypes
      .filter((t) => !q || (t.pluralLabel ?? t.label).toLowerCase().includes(q))
      .map((t) => ({
        key: `type-${t.id}`,
        kind: 'type' as const,
        label: t.pluralLabel ?? t.label,
        hint: 'Item type',
        href: `/w/${props.workspaceSlug}/types/${t.id}`,
      })),
    ...(viewResults?.data ?? [])
      .filter((v) => !q || v.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map((v) => ({
        key: `view-${v.id}`,
        kind: 'view' as const,
        label: v.name,
        hint: 'Saved view',
        href: `/w/${props.workspaceSlug}/types/${v.itemTypeId}`,
      })),
    ...(q.length >= 2 ? (itemResults?.data ?? []) : []).map((item) => ({
      key: `item-${item.id}`,
      kind: 'item' as const,
      label: item.title,
      hint: 'Item',
      href: `/w/${props.workspaceSlug}/items/${item.id}`,
    })),
  ].slice(0, 12);

  const go = useCallback(
    (entry: PaletteEntry | undefined) => {
      if (!entry) return;
      setOpen(false);
      router.push(entry.href);
    },
    [router],
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Command palette"
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/30 pt-[15vh]"
      onClick={() => setOpen(false)}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-[var(--radius-lg)] border bg-[var(--color-surface)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
          placeholder="Jump to an item, type, or view…"
          aria-label="Search everything"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setSelected((s) => Math.min(s + 1, entries.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setSelected((s) => Math.max(s - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              go(entries[selected]);
            }
          }}
        />
        <ul role="listbox" aria-label="Results" className="max-h-72 overflow-y-auto py-1">
          {entries.length === 0 && (
            <li className="px-4 py-6 text-center text-xs text-[var(--color-ink-subtle)]">
              {q.length >= 2 ? 'Nothing matches.' : 'Type to search items; types and views are listed as you filter.'}
            </li>
          )}
          {entries.map((entry, i) => (
            <li key={entry.key} role="option" aria-selected={i === selected}>
              <button
                type="button"
                className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm ${
                  i === selected ? 'bg-[var(--color-muted)]' : ''
                }`}
                onMouseEnter={() => setSelected(i)}
                onClick={() => go(entry)}
              >
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                <span className="shrink-0 text-[11px] uppercase tracking-wide text-[var(--color-ink-subtle)]">
                  {entry.hint}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
