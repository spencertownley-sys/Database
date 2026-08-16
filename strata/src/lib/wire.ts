/**
 * The wire-format boundary — API Design §1.2.
 *
 * Request and response bodies are `snake_case` on the wire; everything inside
 * the server is `camelCase`. The conversion happens exactly once, here, at the
 * route boundary, so neither side ever needs to know the other's convention.
 *
 * **User-keyed bags are never converted.** `values`, `effective_values`,
 * `config`, and their relatives are keyed by *user data* (field keys, option
 * ids, arbitrary JSON). Recasing those keys would corrupt customer data — a
 * field key is an identifier the customer owns, not a name we style. The
 * PRESERVE set lists every such key; children beneath one pass through
 * untouched. When adding a JSONB column whose keys are user-controlled, add it
 * here in the same commit.
 */

const PRESERVE_SUBTREES = new Set([
  // item value bags, keyed by field key
  'values',
  'effective_values',
  'effectiveValues',
  'invalid_values',
  'invalidValues',
  'variant_axis_values',
  'variantAxisValues',
  'axis_values',
  'axisValues',
  'default_value',
  'defaultValue',
  // field/type configuration (select options, precision, etc.)
  'config',
  'settings',
  // change-set summary + webhook payloads keyed by field key. (`before`/
  // `after`/`patch` are NOT preserved: their own keys are system keys, and the
  // user-keyed bags nested inside them are caught by the entries above.)
  'by_field',
  'byField',
  'changes',
  // view config maps keyed by field key
  'column_widths',
  'columnWidths',
  'board_wip_limits',
  'boardWipLimits',
  // import mappings, webhook payloads, notification payloads
  'mapping',
  'payload',
  // error envelopes carry free-form keys defined per code
  'details',
]);

/** Filter trees carry `field` values, not field-keyed objects — safe to walk. */

function camelToSnake(key: string): string {
  return key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function convertKeys(value: unknown, convert: (key: string) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => convertKeys(v, convert));
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const converted = convert(key);
    out[converted] = PRESERVE_SUBTREES.has(key) ? serialiseDatesOnly(child) : convertKeys(child, convert);
  }
  return out;
}

/** Even preserved subtrees need Dates flattened to RFC 3339 strings. */
function serialiseDatesOnly(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serialiseDatesOnly);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    out[key] = serialiseDatesOnly(child);
  }
  return out;
}

/** Server camelCase → wire snake_case. Applied to every response body. */
export function toWire(value: unknown): unknown {
  return convertKeys(value, camelToSnake);
}

/** Wire snake_case → server camelCase. Applied to request bodies and queries. */
export function fromWire(value: unknown): unknown {
  return convertKeys(value, snakeToCamel);
}

/** Collection envelope: `{ data, meta: { cursor, has_more, total } }`. */
export interface CollectionMeta {
  cursor: string | null;
  hasMore: boolean;
  /** `null` when an exact count is not worth the scan (filtered, > 10k rows). */
  total: number | null;
}

export function collection<T>(data: readonly T[], meta: CollectionMeta): {
  data: readonly T[];
  meta: CollectionMeta;
} {
  return { data, meta };
}
