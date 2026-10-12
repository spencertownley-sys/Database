/**
 * The 14 v1 field types, their per-type configuration, and the projection
 * mapping that decides which `item_field_index` column a value lands in.
 *
 * Adding a type means touching four places, all of which are exhaustively
 * checked by the compiler if you extend `FieldType` first:
 *   1. `FIELD_TYPES` here (and its config shape),
 *   2. `src/server/validation/fieldTypes.ts` — coerce/validate/format,
 *   3. `src/components/grid/editors/` — the cell editor,
 *   4. `INDEX_COLUMN_BY_TYPE` below — where it sorts and filters.
 */

export const FIELD_TYPES = [
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
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

/** Whether a field's value is shared with variants or owned per-variant. */
export const INHERITANCE_MODES = ['shared', 'variant'] as const;
export type InheritanceMode = (typeof INHERITANCE_MODES)[number];

export interface SelectOption {
  /** Stable id. Renaming a label must not rewrite stored values. */
  id: string;
  label: string;
  /** Tailwind-safe token resolved through a palette map, never raw CSS. */
  color?: string;
  order: number;
  archived?: boolean;
}

export interface FieldConfigMap {
  text: { minLength?: number; maxLength?: number; pattern?: string };
  long_text: { maxLength?: number; rich?: boolean };
  number: { min?: number; max?: number; precision?: number; unit?: string };
  currency: { currencyCode: string; min?: number; max?: number; precision?: number };
  percent: { min?: number; max?: number; precision?: number };
  date: Record<string, never>;
  datetime: { timezone?: string };
  select: { options: SelectOption[] };
  multi_select: { options: SelectOption[]; maxSelected?: number };
  checkbox: Record<string, never>;
  url: { allowedSchemes?: string[] };
  email: Record<string, never>;
  user: { multiple?: boolean };
  relation: { targetItemTypeId: string; multiple?: boolean };
}

export type FieldConfig<T extends FieldType = FieldType> = FieldConfigMap[T];

/**
 * `item_field_index` carries one typed value column per storage class. A field
 * filters and sorts on exactly one of them; anything not listed here can only
 * be matched for presence/absence.
 */
export const INDEX_COLUMNS = ['text', 'number', 'date', 'bool', 'uuid', 'text_array'] as const;
export type IndexColumn = (typeof INDEX_COLUMNS)[number];

export const INDEX_COLUMN_BY_TYPE: Record<FieldType, IndexColumn> = {
  text: 'text',
  long_text: 'text',
  number: 'number',
  currency: 'number',
  percent: 'number',
  date: 'date',
  datetime: 'date',
  // A select stores the option *id*; the label is presentation and may change.
  select: 'text',
  multi_select: 'text_array',
  checkbox: 'bool',
  url: 'text',
  email: 'text',
  user: 'uuid',
  relation: 'uuid',
};

/** Types whose text contributes to `items.search_text`. */
export const SEARCHABLE_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  'text',
  'long_text',
  'url',
  'email',
]);

/** Types that can back a variant axis. Only `select` in v1. */
export const VARIANT_AXIS_TYPES: ReadonlySet<FieldType> = new Set<FieldType>(['select']);

/** Types that can group a board column. */
export const BOARD_GROUPABLE_TYPES: ReadonlySet<FieldType> = new Set<FieldType>(['select', 'user']);

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  long_text: 'Long text',
  number: 'Number',
  currency: 'Currency',
  percent: 'Percent',
  date: 'Date',
  datetime: 'Date & time',
  select: 'Select',
  multi_select: 'Multi-select',
  checkbox: 'Checkbox',
  url: 'URL',
  email: 'Email',
  user: 'Person',
  relation: 'Relation',
};

/**
 * Which type conversions preserve data without coercion. Anything outside this
 * map goes through the conversion preview in the Item Type builder, which
 * reports clean / coerced / preserved-as-text counts before committing.
 */
export const LOSSLESS_CONVERSIONS: Partial<Record<FieldType, ReadonlySet<FieldType>>> = {
  text: new Set<FieldType>(['long_text']),
  long_text: new Set<FieldType>(['text']),
  number: new Set<FieldType>(['text', 'long_text', 'currency', 'percent']),
  currency: new Set<FieldType>(['number', 'text', 'long_text']),
  percent: new Set<FieldType>(['number', 'text', 'long_text']),
  date: new Set<FieldType>(['datetime', 'text', 'long_text']),
  datetime: new Set<FieldType>(['text', 'long_text']),
  select: new Set<FieldType>(['multi_select', 'text', 'long_text']),
  url: new Set<FieldType>(['text', 'long_text']),
  email: new Set<FieldType>(['text', 'long_text']),
  checkbox: new Set<FieldType>(['text', 'long_text']),
};

export function isFieldType(v: unknown): v is FieldType {
  return typeof v === 'string' && (FIELD_TYPES as readonly string[]).includes(v);
}

/** A stored per-field validation failure. The rest of the item still commits. */
export interface InvalidValue {
  /** The value exactly as the user typed it, so nothing is lost. */
  raw: unknown;
  message: string;
  /** ISO timestamp of the write that failed to coerce. */
  at: string;
}
