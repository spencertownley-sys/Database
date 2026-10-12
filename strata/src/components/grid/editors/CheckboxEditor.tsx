'use client';

import { useEffect } from 'react';
import type { CellEditorProps } from './types';

/**
 * A checkbox has no meaningful edit mode — opening one is the same gesture as
 * toggling it. Entering edit therefore commits the flip immediately and closes,
 * which is what Space and a click both do in a spreadsheet.
 */
export function CheckboxEditor(props: CellEditorProps) {
  useEffect(() => {
    const typed = props.replace ? props.initialValue?.trim().toLowerCase() : undefined;
    const next =
      typed === undefined || typed === ''
        ? !(props.value === true)
        : ['y', 't', '1', 'x'].includes(typed);
    props.commit(next, 'none');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <span className="sr-only">Toggling {props.field.label}</span>;
}
