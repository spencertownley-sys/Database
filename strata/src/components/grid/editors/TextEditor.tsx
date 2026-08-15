'use client';

import { useEffect, useRef, useState } from 'react';
import { EDITOR_INPUT_CLASS, seedText, type CellEditorProps } from './types';

export function TextEditor(props: CellEditorProps) {
  const [draft, setDraft] = useState(() => seedText(props, String(props.value ?? '')));
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = ref.current;
    if (!input) return;
    input.focus();
    // Typing over a cell leaves the caret after the typed character; F2 and
    // double-click put it at the end so the existing value can be extended.
    input.setSelectionRange(draft.length, draft.length);
    // Intentionally runs once: re-selecting on every keystroke would fight the
    // user's caret.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <input
      ref={ref}
      className={EDITOR_INPUT_CLASS}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => props.commit(draft, 'none')}
      aria-label={props.field.label}
    />
  );
}
