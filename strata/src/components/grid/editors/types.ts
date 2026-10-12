'use client';

import type { Field } from '@/server/db/schema/itemTypes';
import type { FieldType } from '@/types/fields';

/**
 * The contract every cell editor implements.
 *
 * `commit` receives the *raw* string (or structured value) the user produced.
 * Coercion happens server-side through the same `fieldTypes` handlers an
 * import uses, so a value typed into the grid and the same value pasted from a
 * CSV cannot be interpreted differently.
 */
export interface CellEditorProps {
  field: Field;
  value: unknown;
  /** Seed text when the edit began by typing over the cell. */
  initialValue?: string;
  /** True when typing replaced the value rather than opening it for edit. */
  replace: boolean;
  commit: (value: unknown, direction?: 'down' | 'up' | 'left' | 'right' | 'none') => void;
  cancel: () => void;
}

export type CellEditor = (props: CellEditorProps) => React.ReactElement;

/** Shared input chrome so every editor sits flush inside the cell box. */
export const EDITOR_INPUT_CLASS =
  'absolute inset-0 z-20 w-full h-full px-2 text-sm bg-[var(--color-surface)] ' +
  'border-2 border-[var(--color-accent)] rounded-[2px] outline-none';

export function seedText(props: CellEditorProps, formatted: string): string {
  if (props.replace) return props.initialValue ?? '';
  return props.initialValue ?? formatted;
}

export const EDITOR_BY_TYPE_KEYS: readonly FieldType[] = [
  'text',
  'long_text',
  'number',
  'currency',
  'percent',
  'date',
  'datetime',
  'select',
  'multi_select',
  'checkbox',
  'url',
  'email',
  'user',
  'relation',
];
