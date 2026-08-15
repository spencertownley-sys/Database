'use client';

import type { FieldType } from '@/types/fields';
import type { CellEditorProps } from './types';
import { TextEditor } from './TextEditor';
import { LongTextEditor } from './LongTextEditor';
import { NumberEditor } from './NumberEditor';
import { CurrencyEditor } from './CurrencyEditor';
import { PercentEditor } from './PercentEditor';
import { DateEditor } from './DateEditor';
import { DateTimeEditor } from './DateTimeEditor';
import { SelectEditor } from './SelectEditor';
import { MultiSelectEditor } from './MultiSelectEditor';
import { CheckboxEditor } from './CheckboxEditor';
import { UrlEditor } from './UrlEditor';
import { EmailEditor } from './EmailEditor';
import { UserEditor } from './UserEditor';
import { RelationEditor } from './RelationEditor';

/**
 * One editor per field type — the map is exhaustive by construction, so adding
 * a field type is a compile error here until its editor exists rather than a
 * cell that silently refuses to open.
 */
export const EDITORS: Record<FieldType, (props: CellEditorProps) => React.ReactElement> = {
  text: TextEditor,
  long_text: LongTextEditor,
  number: NumberEditor,
  currency: CurrencyEditor,
  percent: PercentEditor,
  date: DateEditor,
  datetime: DateTimeEditor,
  select: SelectEditor,
  multi_select: MultiSelectEditor,
  checkbox: CheckboxEditor,
  url: UrlEditor,
  email: EmailEditor,
  user: UserEditor,
  relation: RelationEditor,
};

export type { CellEditorProps } from './types';
export { UserEditor };
