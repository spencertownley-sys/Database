'use client';

import { useEffect, useRef, useState } from 'react';
import { EDITOR_INPUT_CLASS, seedText, type CellEditorProps } from './types';

/**
 * Deliberately `type="text"`, not `type="number"`. A number input silently
 * discards what it cannot parse as the user types, so pasting "1,250" or
 * typing "45%" loses characters with no feedback. Keeping it text lets the
 * server's tolerant coercion see exactly what the person entered — and lets an
 * unparseable value land in `invalid_values` with their original text intact.
 */
export function NumberEditor(props: CellEditorProps) {
  const [draft, setDraft] = useState(() =>
    seedText(props, props.value === null || props.value === undefined ? '' : String(props.value)),
  );
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
      inputMode="decimal"
      className={`${EDITOR_INPUT_CLASS} text-right tabular`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => props.commit(draft, 'none')}
      aria-label={props.field.label}
    />
  );
}
