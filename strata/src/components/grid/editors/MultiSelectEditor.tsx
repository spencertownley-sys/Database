'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SelectOption } from '@/types/fields';
import type { CellEditorProps } from './types';

/** Toggling stays open; Enter commits the accumulated set. */
export function MultiSelectEditor(props: CellEditorProps) {
  const options = ((props.field.config as { options?: SelectOption[] }).options ?? []).filter(
    (o) => !o.archived,
  );
  const [selected, setSelected] = useState<string[]>(() =>
    Array.isArray(props.value) ? (props.value as string[]) : [],
  );
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  return (
    <div className="absolute left-0 top-0 z-30 w-[min(18rem,50vw)] rounded-[var(--radius-md)] border-2 border-[var(--color-accent)] bg-[var(--color-surface)] shadow-lg">
      <input
        ref={ref}
        className="w-full border-b bg-transparent px-2 py-1.5 text-sm outline-none"
        value={query}
        placeholder="Search…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            props.commit(selected.length ? selected : null, 'down');
          }
        }}
        aria-label={props.field.label}
      />
      <ul className="max-h-56 overflow-y-auto py-1">
        {filtered.map((option) => {
          const isOn = selected.includes(option.id);
          return (
            <li key={option.id}>
              <button
                type="button"
                aria-pressed={isOn}
                className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-[var(--color-muted)]"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setSelected((current) =>
                    isOn ? current.filter((id) => id !== option.id) : [...current, option.id],
                  );
                }}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 shrink-0 rounded-[3px] border ${
                    isOn ? 'border-[var(--color-accent)] bg-[var(--color-accent)]' : ''
                  }`}
                />
                <span className="truncate">{option.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end border-t px-2 py-1">
        <button
          type="button"
          className="rounded px-2 py-0.5 text-xs font-medium text-[var(--color-accent)]"
          onMouseDown={(e) => {
            e.preventDefault();
            props.commit(selected.length ? selected : null, 'down');
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
