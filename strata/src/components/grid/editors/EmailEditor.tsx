'use client';

import { useEffect, useRef, useState } from 'react';
import { EDITOR_INPUT_CLASS, seedText, type CellEditorProps } from './types';

/** Accepts the "Name <a@b.com>" shape a pasted mail-client column produces. */
export function EmailEditor(props: CellEditorProps) {
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
      type="text"
      inputMode="email"
      className={EDITOR_INPUT_CLASS}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => props.commit(draft, 'none')}
      aria-label={props.field.label}
    />
  );
}
