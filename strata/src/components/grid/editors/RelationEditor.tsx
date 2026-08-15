'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { CellEditorProps } from './types';

interface Candidate {
  id: string;
  title: string;
}

/**
 * Relation search hits the server because the candidate set is the whole
 * target Item Type, which can be 100k rows. Debounced, and it searches by
 * title because that is what a person knows — the id is committed.
 */
export function RelationEditor(props: CellEditorProps) {
  const targetTypeId = (props.field.config as { targetItemTypeId?: string }).targetItemTypeId;
  const [query, setQuery] = useState(props.replace ? (props.initialValue ?? '') : '');
  const [results, setResults] = useState<Candidate[]>([]);
  const [highlight, setHighlight] = useState(0);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  useEffect(() => {
    if (!targetTypeId) return undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api.items
        .list({ itemTypeId: targetTypeId, q: query, limit: 20 }, controller.signal)
        .then((page) => setResults(page.data.map((i) => ({ id: i.id, title: i.title }))))
        .catch(() => {
          // An aborted or failed lookup leaves the previous results on screen
          // rather than blanking the list mid-keystroke.
        });
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [query, targetTypeId]);

  return (
    <div className="absolute left-0 top-0 z-30 w-[min(20rem,50vw)] rounded-[var(--radius-md)] border-2 border-[var(--color-accent)] bg-[var(--color-surface)] shadow-lg">
      <input
        ref={ref}
        className="w-full border-b bg-transparent px-2 py-1.5 text-sm outline-none"
        value={query}
        placeholder="Search items…"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            const picked = results[highlight];
            props.commit(picked ? picked.id : null, 'down');
          }
        }}
        aria-label={props.field.label}
      />
      <ul className="max-h-56 overflow-y-auto py-1" role="listbox">
        {results.length === 0 && (
          <li className="px-2 py-1.5 text-sm text-[var(--color-ink-subtle)]">No matches</li>
        )}
        {results.map((candidate, i) => (
          <li key={candidate.id}>
            <button
              type="button"
              role="option"
              aria-selected={i === highlight}
              className={`w-full truncate px-2 py-1.5 text-left text-sm ${
                i === highlight ? 'bg-[var(--color-accent-soft)]' : ''
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                props.commit(candidate.id, 'down');
              }}
            >
              {candidate.title || 'Untitled'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
