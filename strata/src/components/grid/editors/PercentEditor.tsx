'use client';

import { NumberEditor } from './NumberEditor';
import type { CellEditorProps } from './types';

/**
 * Percent shares NumberEditor's behaviour: text input, tolerant server-side
 * coercion, and the user's raw entry preserved when it cannot be parsed.
 * Symbols and separators are stripped on coercion, so "£1,250.00" and "1250"
 * both land as the same number.
 */
export function PercentEditor(props: CellEditorProps) {
  return <NumberEditor {...props} />;
}
