'use client';

import { useEffect, useRef, useState } from 'react';
import { EDITOR_INPUT_CLASS, seedText, type CellEditorProps } from './types';

/** A bare domain is what people paste, so the server assumes https rather
 *  than rejecting it. Only http/https are accepted — a javascript: URL in a
 *  cell that later renders as a link is a stored XSS. */
export function UrlEditor(props: CellEditorProps) {
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
      inputMode="url"
      className={EDITOR_INPUT_CLASS}
      value={draft}
      placeholder="example.com"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => props.commit(draft, 'none')}
      aria-label={props.field.label}
    />
  );
}
