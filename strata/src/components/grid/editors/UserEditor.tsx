'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CellEditorProps } from './types';

export interface WorkspaceMemberOption {
  id: string;
  name: string | null;
  email: string;
}

/**
 * Members are supplied by the grid rather than fetched here: opening a picker
 * on 300 rows would otherwise issue 300 identical requests.
 */
export function UserEditor(props: CellEditorProps & { members?: WorkspaceMemberOption[] }) {
  const [query, setQuery] = useState(props.replace ? (props.initialValue ?? '') : '');
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const filtered = useMemo(() => {
    // The `?? []` lives inside the memo: as a bare expression above it would
    // allocate a new array each render and re-run the memo every time.
    const members = props.members ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) => (m.name ?? '').toLowerCase().includes(q) || m.email.toLowerCase().includes(q),
    );
  }, [props.members, query]);

  return (
    <div className="absolute left-0 top-0 z-30 w-[min(18rem,50vw)] rounded-[var(--radius-md)] border-2 border-[var(--color-accent)] bg-[var(--color-surface)] shadow-lg">
      <input
        ref={ref}
        className="w-full border-b bg-transparent px-2 py-1.5 text-sm outline-none"
        value={query}
        placeholder="Search people…"
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
          <li className="px-2 py-1.5 text-sm text-[var(--color-ink-subtle)]">No members match</li>
        )}
        {filtered.map((member, i) => (
          <li key={member.id}>
            <button
              type="button"
              role="option"
              aria-selected={i === highlight}
              className={`w-full px-2 py-1.5 text-left text-sm ${
                i === highlight ? 'bg-[var(--color-accent-soft)]' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                props.commit(member.id, 'down');
              }}
            >
              <span className="block truncate">{member.name ?? member.email}</span>
              {member.name && (
                <span className="block truncate text-xs text-[var(--color-ink-subtle)]">
                  {member.email}
                </span>
              )}
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
            Unassign
          </button>
        </li>
      </ul>
    </div>
  );
}
