'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SelectOption } from '@/types/fields';
import type { CellEditorProps } from './types';

/**
 * Type-to-filter, Enter to pick. The list is filtered by label because that is
 * what the user sees and types; the *id* is what gets committed, so renaming
 * an option later never rewrites a single stored value.
 */
export function SelectEditor(props: CellEditorProps) {
  const options = ((props.field.config as { options?: SelectOption[] }).options ?? []).filter(
    (o) => !o.archived,
  );
  const [query, setQuery] = useState(props.replace ? (props.initialValue ?? '') : '');
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => setHighlight(0), [query]);

  return (
    <div className="absolute left-0 top-0 z-30 w-[min(16rem,50vw)] rounded-[var(--radius-md)] border-2 border-[var(--color-accent)] bg-[var(--color-surface)] shadow-lg">
      <input
        ref={ref}
        className="w-full border-b bg-transparent px-2 py-1.5 text-sm outline-none"
        value={query}
        placeholder="Search…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, filtered.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            const picked = filtered[highlight];
            props.commit(picked ? picked.id : null, 'down');
          }
        }}
        aria-label={props.field.label}
      />
      <ul className="max-h-56 overflow-y-auto py-1" role="listbox">
        {filtered.length === 0 && (
          <li className="px-2 py-1.5 text-sm text-[var(--color-ink-subtle)]">No matches</li>
        )}
        {filtered.map((option, i) => (
          <li key={option.id}>
            <button
              type="button"
              role="option"
              aria-selected={i === highlight}
              className={`flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm ${
                i === highlight ? 'bg-[var(--color-accent-soft)]' : ''
              }`}
              onMouseDown={(e) => {
                // mousedown, not click: the cell's blur handler would commit
                // and unmount the list before a click ever lands.
                e.preventDefault();
                props.commit(option.id, 'down');
              }}
            >
              <span className="truncate">{option.label}</span>
            </button>
          </li>
        ))}
        <li className="border-t">
          <button
            type="button"
            className="w-full px-2 py-1.5 text-left text-sm text-[var(--color-ink-subtle)]"
            onMouseDown={(e) => {
              e.preventDefault();
              props.commit(null, 'down');
            }}
          >
            Clear
          </button>
        </li>
      </ul>
    </div>
  );
}
