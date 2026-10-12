'use client';

import { useEffect, useRef, useState } from 'react';
import { EDITOR_INPUT_CLASS, seedText, type CellEditorProps } from './types';

/**
 * A text input, not `<input type="date">`.
 *
 * The native date input only accepts its own locale format and rejects
 * everything else without saying so, which breaks the two things people
 * actually do: typing "3/14" and pasting a column out of Excel. The server
 * parses ISO, US, European, and Excel serial forms, and flags genuinely
 * ambiguous values rather than guessing silently.
 */
export function DateEditor(props: CellEditorProps) {
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
      placeholder="YYYY-MM-DD"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => props.commit(draft, 'none')}
      aria-label={props.field.label}
    />
  );
}
