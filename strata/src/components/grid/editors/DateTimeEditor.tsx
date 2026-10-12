'use client';

import { useEffect, useRef, useState } from 'react';
import { EDITOR_INPUT_CLASS, seedText, type CellEditorProps } from './types';

/** Same reasoning as DateEditor: tolerant text entry beats a native picker
 *  that silently rejects everything but its own locale format. */
export function DateTimeEditor(props: CellEditorProps) {
  const [draft, setDraft] = useState(() => seedText(props, String(props.value ?? '')));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(draft.length, draft.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <input
      ref={ref}
      className={EDITOR_INPUT_CLASS}
      value={draft}
      placeholder="YYYY-MM-DD HH:mm"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => props.commit(draft, 'none')}
      aria-label={props.field.label}
    />
  );
}
