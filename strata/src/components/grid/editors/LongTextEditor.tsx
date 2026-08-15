'use client';

import { useEffect, useRef, useState } from 'react';
import { seedText, type CellEditorProps } from './types';

/**
 * Long text opens into a popover rather than expanding the row: growing the
 * row height mid-edit reflows the virtualiser and scrolls the grid out from
 * under the person typing.
 */
export function LongTextEditor(props: CellEditorProps) {
  const [draft, setDraft] = useState(() => seedText(props, String(props.value ?? '')));
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(draft.length, draft.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="absolute left-0 top-0 z-30 w-[min(28rem,60vw)] rounded-[var(--radius-md)] border-2 border-[var(--color-accent)] bg-[var(--color-surface)] shadow-lg">
      <textarea
        ref={ref}
        className="h-40 w-full resize-none bg-transparent p-2 text-sm outline-none"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-label={props.field.label}
      />
      <div className="flex items-center justify-between border-t px-2 py-1 text-xs text-[var(--color-ink-subtle)]">
        <span>⌘↵ to save · Esc to cancel</span>
        <button
          type="button"
          className="rounded px-2 py-0.5 font-medium text-[var(--color-accent)] hover:bg-[var(--color-accent-soft)]"
          onClick={() => props.commit(draft, 'none')}
        >
          Save
        </button>
      </div>
    </div>
  );
}
