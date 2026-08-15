/**
 * The 14 field types: coercion, validation, formatting, and projection.
 *
 * Two rules shape this whole file.
 *
 * **Coercion is generous; validation is honest.** A user pasting from Excel
 * sends `"1,250"`, `"£1,250.00"`, `" 45% "`, `"TRUE"`, `"3/14/2026"`. Refusing
 * those is refusing the product's core workflow, so coercion tries hard. What
 * it must never do is guess *wrongly and silently* — anything genuinely
 * ambiguous fails with a message the person who typed it can act on.
 *
 * **A failure never blocks the save.** `coerce` returning `ok: false` sends
 * that one field to `items.invalid_values` while every other field on the item
 * commits. Rejecting a whole row because one cell says "TBD" loses real work
 * and gets reported as data loss.
 *
 * Coercion is synchronous by design. Anything needing a database lookup
 * (resolving a person by email, a relation by title) arrives pre-fetched on
 * `CoerceContext`, so a 10,000-row paste resolves lookups in two queries
 * rather than 10,000 round trips.
 */

import type {
  FieldConfig,
  FieldConfigMap,
  FieldType,
  IndexColumn,
  SelectOption,
} from '@/types/fields';
import { INDEX_COLUMN_BY_TYPE } from '@/types/fields';

export type CoerceResult =
  | { ok: true; value: unknown }
  | { ok: false; message: string; raw: unknown };

export interface CoerceContext {
  /** lower(email) → user id, for `user` fields fed by a spreadsheet column. */
  usersByEmail?: Map<string, string>;
  /** Valid user ids in this workspace, so a stray uuid cannot be stored. */
  knownUserIds?: Set<string>;
  /** lower(title) → item id, per target Item Type, for `relation` fields. */
  itemsByTitle?: Map<string, Map<string, string>>;
  knownItemIds?: Set<string>;
  /** Used for relative date parsing so a batch shares one "today". */
  now?: Date;
}

export interface IndexValue {
  column: IndexColumn | null;
  valueText?: string | null;
  valueNumber?: number | null;
  valueDate?: Date | null;
  valueBool?: boolean | null;
  valueUuid?: string | null;
  valueTextArray?: string[] | null;
}

export interface FieldTypeHandler {
  type: FieldType;
  /** Which `item_field_index` column values land in. Depends on config for
   *  the multi-valued variants of `user` and `relation`. */
  indexColumn(config: FieldConfig): IndexColumn;
  coerce(raw: unknown, config: FieldConfig, ctx?: CoerceContext): CoerceResult;
  /** Post-coercion constraint check. Returns a message, or null when valid. */
  validate(value: unknown, config: FieldConfig): string | null;
  /** Display and export rendering. Never used as a storage format. */
  format(value: unknown, config: FieldConfig): string;
  isEmpty(value: unknown): boolean;
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------

const EMPTY_STRINGS = new Set(['', '-', '—', 'n/a', 'na', 'null', 'none', 'undefined']);

export function isBlank(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return EMPTY_STRINGS.has(value.trim().toLowerCase());
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function ok(value: unknown): CoerceResult {
  return { ok: true, value };
}

function fail(raw: unknown, message: string): CoerceResult {
  return { ok: false, message, raw };
}

function asString(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  if (raw instanceof Date) return raw.toISOString();
  return String(raw);
}

/**
 * Numeric parsing tolerant of what spreadsheets actually emit: thousands
 * separators, a leading currency symbol, a trailing percent, parenthesised
 * negatives (`(1,250)` is accounting for -1250), and non-breaking spaces.
 */
function parseNumberLoose(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (typeof raw !== 'string') return null;

  let s = raw.trim().replace(/ /g, ' ');
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }

  // Strip currency symbols, percent signs, and spaces — but not the sign,
  // the decimal point, or digits.
  s = s.replace(/[^\d.,\-+eE]/g, '');
  if (!s) return null;

  // "1.234,56" (European) vs "1,234.56" (US). Decide by which separator is
  // rightmost; a lone separator with exactly three trailing digits is
  // thousands, not a decimal.
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    const after = s.length - lastComma - 1;
    s = after === 3 ? s.replace(/,/g, '') : s.replace(',', '.');
  }

  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE_RE = /^(\d{1,2})[/](\d{1,2})[/](\d{2}|\d{4})$/;
const DOT_DATE_RE = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Date parsing, deliberately conservative about ambiguity.
 *
 * `03/04/2026` is 3 April in most of the world and 4 March in the US, and no
 * amount of cleverness resolves that from the value alone. We take the US
 * reading (matching Excel's default export on a US locale, which is where
 * most pasted data comes from) *only* when the first component cannot be a
 * day-of-month ambiguity — otherwise both readings are valid and we prefer
 * the US one but the value is flagged in the import report so a human sees it.
 */
function parseDateLoose(raw: unknown): { iso: string; ambiguous: boolean } | null {
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return {
      iso: `${raw.getUTCFullYear()}-${pad(raw.getUTCMonth() + 1)}-${pad(raw.getUTCDate())}`,
      ambiguous: false,
    };
  }
  if (typeof raw === 'number') {
    // Excel serial date: days since 1899-12-30 (its leap-year bug included).
    if (raw > 0 && raw < 100_000) {
      const ms = Math.round((raw - 25569) * 86_400_000);
      const dt = new Date(ms);
      if (!Number.isNaN(dt.getTime())) {
        return {
          iso: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
          ambiguous: false,
        };
      }
    }
    return null;
  }
  if (typeof raw !== 'string') return null;

  const s = raw.trim();
  if (!s) return null;

  const iso = ISO_DATE_RE.exec(s);
  if (iso) {
    const out = toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return out ? { iso: out, ambiguous: false } : null;
  }

  // Full ISO datetime — take the date part in UTC.
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(s)) {
    const dt = new Date(s.replace(' ', 'T'));
    if (!Number.isNaN(dt.getTime())) {
      return {
        iso: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`,
        ambiguous: false,
      };
    }
  }

  const us = US_DATE_RE.exec(s);
  if (us) {
    const a = Number(us[1]);
    const b = Number(us[2]);
    let y = Number(us[3]);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    // a > 12 can only be a day, so the layout is unambiguous (D/M/Y).
    if (a > 12) {
      const out = toIsoDate(y, b, a);
      return out ? { iso: out, ambiguous: false } : null;
    }
    const out = toIsoDate(y, a, b);
    if (!out) return null;
    return { iso: out, ambiguous: b <= 12 };
  }

  const dot = DOT_DATE_RE.exec(s);
  if (dot) {
    // Dotted dates are European convention: D.M.Y.
    let y = Number(dot[3]);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    const out = toIsoDate(y, Number(dot[2]), Number(dot[1]));
    return out ? { iso: out, ambiguous: false } : null;
  }

  const parsed = new Date(s);
  if (!Number.isNaN(parsed.getTime()) && /\d{4}/.test(s)) {
    return {
      iso: `${parsed.getUTCFullYear()}-${pad(parsed.getUTCMonth() + 1)}-${pad(parsed.getUTCDate())}`,
      ambiguous: false,
    };
  }
  return null;
}

const TRUE_TOKENS = new Set(['true', 't', 'yes', 'y', '1', 'x', '✓', '✔', 'on', 'checked', 'done']);
const FALSE_TOKENS = new Set(['false', 'f', 'no', 'n', '0', '', 'off', 'unchecked']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Deliberately permissive: the RFC grammar accepts addresses this rejects, but
// a stricter pattern here rejects addresses users legitimately have. Bounce
// handling is the real validator.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

function optionsOf(config: FieldConfig): SelectOption[] {
  const opts = (config as { options?: SelectOption[] }).options;
  return Array.isArray(opts) ? opts : [];
}

/** Matches an option by id first, then by label case-insensitively. */
function resolveOption(raw: string, options: SelectOption[]): SelectOption | null {
  const trimmed = raw.trim();
  const byId = options.find((o) => o.id === trimmed);
  if (byId) return byId;
  const lower = trimmed.toLowerCase();
  return options.find((o) => o.label.trim().toLowerCase() === lower) ?? null;
}

function splitList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(asString);
  const s = asString(raw);
  if (!s.trim()) return [];
  // Excel multi-value cells use comma, semicolon, pipe, or newline.
  return s
    .split(/[\n;|,]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function numberBounds(
  value: number,
  config: { min?: number; max?: number },
  noun: string,
): string | null {
  if (config.min !== undefined && value < config.min) {
    return `${noun} must be at least ${config.min}.`;
  }
  if (config.max !== undefined && value > config.max) {
    return `${noun} must be at most ${config.max}.`;
  }
  return null;
}

function round(value: number, precision: number | undefined): number {
  if (precision === undefined) return value;
  const f = 10 ** precision;
  return Math.round(value * f) / f;
}

// ---------------------------------------------------------------------------
// handlers
// ---------------------------------------------------------------------------

const textHandler: FieldTypeHandler = {
  type: 'text',
  indexColumn: () => 'text',
  coerce(raw, config) {
    if (isBlank(raw)) return ok(null);
    const cfg = config as FieldConfigMap['text'];
    // Single-line: a pasted multi-line cell collapses rather than failing.
    const s = asString(raw).replace(/\s*\n\s*/g, ' ').trim();
    if (cfg.maxLength !== undefined && s.length > cfg.maxLength) {
      return fail(raw, `Longer than the ${cfg.maxLength}-character limit.`);
    }
    return ok(s);
  },
  validate(value, config) {
    if (value === null) return null;
    const cfg = config as FieldConfigMap['text'];
    const s = String(value);
    if (cfg.minLength !== undefined && s.length < cfg.minLength) {
      return `Must be at least ${cfg.minLength} characters.`;
    }
    if (cfg.maxLength !== undefined && s.length > cfg.maxLength) {
      return `Must be at most ${cfg.maxLength} characters.`;
    }
    if (cfg.pattern) {
      try {
        if (!new RegExp(cfg.pattern).test(s)) return 'Does not match the required format.';
      } catch {
        // A malformed pattern is a schema bug, not a value problem — never
        // fail a user's value because an admin typed a bad regex.
        return null;
      }
    }
    return null;
  },
  format: (value) => (value === null || value === undefined ? '' : String(value)),
  isEmpty: isBlank,
};

const longTextHandler: FieldTypeHandler = {
  ...textHandler,
  type: 'long_text',
  coerce(raw, config) {
    if (isBlank(raw)) return ok(null);
    const cfg = config as FieldConfigMap['long_text'];
    const s = asString(raw);
    if (cfg.maxLength !== undefined && s.length > cfg.maxLength) {
      return fail(raw, `Longer than the ${cfg.maxLength}-character limit.`);
    }
    return ok(s);
  },
};

const numberHandler: FieldTypeHandler = {
  type: 'number',
  indexColumn: () => 'number',
  coerce(raw, config) {
    if (isBlank(raw)) return ok(null);
    const n = parseNumberLoose(raw);
    if (n === null) return fail(raw, `"${asString(raw)}" is not a number.`);
    return ok(round(n, (config as FieldConfigMap['number']).precision));
  },
  validate(value, config) {
    if (value === null) return null;
    return numberBounds(Number(value), config as FieldConfigMap['number'], 'Value');
  },
  format(value, config) {
    if (value === null || value === undefined) return '';
    const cfg = config as FieldConfigMap['number'];
    const n = Number(value);
    const s = cfg.precision !== undefined ? n.toFixed(cfg.precision) : String(n);
    return cfg.unit ? `${s} ${cfg.unit}` : s;
  },
  isEmpty: isBlank,
};

const currencyHandler: FieldTypeHandler = {
  type: 'currency',
  indexColumn: () => 'number',
  coerce(raw, config) {
    if (isBlank(raw)) return ok(null);
    const n = parseNumberLoose(raw);
    if (n === null) return fail(raw, `"${asString(raw)}" is not an amount.`);
    return ok(round(n, (config as FieldConfigMap['currency']).precision ?? 2));
  },
  validate(value, config) {
    if (value === null) return null;
    return numberBounds(Number(value), config as FieldConfigMap['currency'], 'Amount');
  },
  format(value, config) {
    if (value === null || value === undefined) return '';
    const cfg = config as FieldConfigMap['currency'];
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: cfg.currencyCode || 'USD',
        minimumFractionDigits: cfg.precision ?? 2,
      }).format(Number(value));
    } catch {
      return String(value);
    }
  },
  isEmpty: isBlank,
};

const percentHandler: FieldTypeHandler = {
  type: 'percent',
  indexColumn: () => 'number',
  /**
   * Stored as the displayed number: 45 means 45%, not 0.45. Storing the
   * fraction means every export, every filter, and every pasted column has to
   * agree on a multiplier, and one of them always disagrees.
   */
  coerce(raw, config) {
    if (isBlank(raw)) return ok(null);
    const s = typeof raw === 'string' ? raw.trim() : raw;
    const n = parseNumberLoose(s);
    if (n === null) return fail(raw, `"${asString(raw)}" is not a percentage.`);
    return ok(round(n, (config as FieldConfigMap['percent']).precision ?? 2));
  },
  validate(value, config) {
    if (value === null) return null;
    const cfg = config as FieldConfigMap['percent'];
    return numberBounds(Number(value), { min: cfg.min ?? 0, max: cfg.max }, 'Percentage');
  },
  format(value, config) {
    if (value === null || value === undefined) return '';
    const cfg = config as FieldConfigMap['percent'];
    const n = Number(value);
    return `${cfg.precision !== undefined ? n.toFixed(cfg.precision) : n}%`;
  },
  isEmpty: isBlank,
};

const dateHandler: FieldTypeHandler = {
  type: 'date',
  indexColumn: () => 'date',
  coerce(raw) {
    if (isBlank(raw)) return ok(null);
    const parsed = parseDateLoose(raw);
    if (!parsed) return fail(raw, `"${asString(raw)}" is not a date we recognise.`);
    return ok(parsed.iso);
  },
  validate: () => null,
  format(value) {
    if (!value) return '';
    return String(value);
  },
  isEmpty: isBlank,
};

const dateTimeHandler: FieldTypeHandler = {
  type: 'datetime',
  indexColumn: () => 'date',
  coerce(raw) {
    if (isBlank(raw)) return ok(null);
    if (raw instanceof Date) {
      return Number.isNaN(raw.getTime()) ? fail(raw, 'Not a valid time.') : ok(raw.toISOString());
    }
    const s = asString(raw).trim();
    const dt = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
    if (!Number.isNaN(dt.getTime())) return ok(dt.toISOString());
    // Date-only input is midnight UTC rather than a failure.
    const dateOnly = parseDateLoose(raw);
    if (dateOnly) return ok(new Date(`${dateOnly.iso}T00:00:00.000Z`).toISOString());
    return fail(raw, `"${s}" is not a date and time we recognise.`);
  },
  validate: () => null,
  format(value) {
    if (!value) return '';
    const dt = new Date(String(value));
    return Number.isNaN(dt.getTime()) ? String(value) : dt.toISOString().replace('.000Z', 'Z');
  },
  isEmpty: isBlank,
};

const selectHandler: FieldTypeHandler = {
  type: 'select',
  indexColumn: () => 'text',
  coerce(raw, config) {
    if (isBlank(raw)) return ok(null);
    const options = optionsOf(config);
    const match = resolveOption(asString(raw), options);
    if (!match) {
      const known = options
        .filter((o) => !o.archived)
        .slice(0, 5)
        .map((o) => o.label)
        .join(', ');
      return fail(
        raw,
        known
          ? `"${asString(raw)}" is not one of the choices (${known}${options.length > 5 ? ', …' : ''}).`
          : `"${asString(raw)}" is not one of the choices — this field has none defined yet.`,
      );
    }
    return ok(match.id);
  },
  validate: () => null,
  format(value, config) {
    if (!value) return '';
    const opt = optionsOf(config).find((o) => o.id === value);
    return opt ? opt.label : String(value);
  },
  isEmpty: isBlank,
};

const multiSelectHandler: FieldTypeHandler = {
  type: 'multi_select',
  indexColumn: () => 'text_array',
  coerce(raw, config) {
    if (isBlank(raw)) return ok(null);
    const options = optionsOf(config);
    const cfg = config as FieldConfigMap['multi_select'];
    const parts = splitList(raw);
    const resolved: string[] = [];
    const unknown: string[] = [];
    for (const part of parts) {
      const match = resolveOption(part, options);
      if (match) {
        if (!resolved.includes(match.id)) resolved.push(match.id);
      } else {
        unknown.push(part);
      }
    }
    if (unknown.length > 0) {
      return fail(raw, `Not among the choices: ${unknown.join(', ')}.`);
    }
    if (cfg.maxSelected !== undefined && resolved.length > cfg.maxSelected) {
      return fail(raw, `At most ${cfg.maxSelected} may be selected.`);
    }
    return ok(resolved.length ? resolved : null);
  },
  validate: () => null,
  format(value, config) {
    if (!Array.isArray(value)) return '';
    const options = optionsOf(config);
    return value
      .map((id) => options.find((o) => o.id === id)?.label ?? String(id))
      .join(', ');
  },
  isEmpty: isBlank,
};

const checkboxHandler: FieldTypeHandler = {
  type: 'checkbox',
  indexColumn: () => 'bool',
  coerce(raw) {
    if (raw === null || raw === undefined || raw === '') return ok(null);
    if (typeof raw === 'boolean') return ok(raw);
    if (typeof raw === 'number') return ok(raw !== 0);
    const s = asString(raw).trim().toLowerCase();
    if (TRUE_TOKENS.has(s)) return ok(true);
    if (FALSE_TOKENS.has(s)) return ok(false);
    return fail(raw, `"${asString(raw)}" is not a yes/no value.`);
  },
  validate: () => null,
  format: (value) => (value === true ? 'Yes' : value === false ? 'No' : ''),
  isEmpty: (value) => value === null || value === undefined || value === '',
};

const urlHandler: FieldTypeHandler = {
  type: 'url',
  indexColumn: () => 'text',
  coerce(raw, config) {
    if (isBlank(raw)) return ok(null);
    const cfg = config as FieldConfigMap['url'];
    const allowed = cfg.allowedSchemes ?? ['http', 'https'];
    let s = asString(raw).trim();
    // A bare domain is what people paste; assume https rather than reject.
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = `https://${s}`;
    let parsed: URL;
    try {
      parsed = new URL(s);
    } catch {
      return fail(raw, `"${asString(raw)}" is not a valid link.`);
    }
    const scheme = parsed.protocol.replace(':', '').toLowerCase();
    if (!allowed.includes(scheme)) {
      return fail(raw, `Links must use ${allowed.join(' or ')}.`);
    }
    if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') {
      return fail(raw, `"${asString(raw)}" is not a valid link.`);
    }
    return ok(parsed.toString());
  },
  validate: () => null,
  format: (value) => (value ? String(value) : ''),
  isEmpty: isBlank,
};

const emailHandler: FieldTypeHandler = {
  type: 'email',
  indexColumn: () => 'text',
  coerce(raw) {
    if (isBlank(raw)) return ok(null);
    const s = asString(raw).trim();
    // "Name <a@b.com>" is what a pasted mail client column looks like.
    const angled = /<([^>]+)>/.exec(s);
    const candidate = (angled?.[1] ?? s).trim().toLowerCase();
    if (!EMAIL_RE.test(candidate)) return fail(raw, `"${s}" is not an email address.`);
    return ok(candidate);
  },
  validate: () => null,
  format: (value) => (value ? String(value) : ''),
  isEmpty: isBlank,
};

const userHandler: FieldTypeHandler = {
  type: 'user',
  indexColumn: (config) => ((config as FieldConfigMap['user']).multiple ? 'text_array' : 'uuid'),
  coerce(raw, config, ctx) {
    if (isBlank(raw)) return ok(null);
    const multiple = (config as FieldConfigMap['user']).multiple === true;
    const parts = multiple ? splitList(raw) : [asString(raw).trim()];
    const resolved: string[] = [];
    const unknown: string[] = [];

    for (const part of parts) {
      if (UUID_RE.test(part)) {
        // Reject an id from another workspace outright — silently storing it
        // would render as a broken avatar forever.
        if (ctx?.knownUserIds && !ctx.knownUserIds.has(part.toLowerCase())) {
          unknown.push(part);
        } else {
          resolved.push(part.toLowerCase());
        }
        continue;
      }
      const email = (/<([^>]+)>/.exec(part)?.[1] ?? part).trim().toLowerCase();
      const id = ctx?.usersByEmail?.get(email);
      if (id) resolved.push(id);
      else unknown.push(part);
    }

    if (unknown.length > 0) {
      return fail(raw, `Not a member of this workspace: ${unknown.join(', ')}.`);
    }
    if (!multiple) return ok(resolved[0] ?? null);
    return ok(resolved.length ? resolved : null);
  },
  validate: () => null,
  format: (value) => (Array.isArray(value) ? value.join(', ') : value ? String(value) : ''),
  isEmpty: isBlank,
};

const relationHandler: FieldTypeHandler = {
  type: 'relation',
  indexColumn: (config) =>
    (config as FieldConfigMap['relation']).multiple ? 'text_array' : 'uuid',
  coerce(raw, config, ctx) {
    if (isBlank(raw)) return ok(null);
    const cfg = config as FieldConfigMap['relation'];
    const multiple = cfg.multiple === true;
    const parts = multiple ? splitList(raw) : [asString(raw).trim()];
    const byTitle = ctx?.itemsByTitle?.get(cfg.targetItemTypeId);
    const resolved: string[] = [];
    const unknown: string[] = [];

    for (const part of parts) {
      if (UUID_RE.test(part)) {
        if (ctx?.knownItemIds && !ctx.knownItemIds.has(part.toLowerCase())) unknown.push(part);
        else resolved.push(part.toLowerCase());
        continue;
      }
      const id = byTitle?.get(part.trim().toLowerCase());
      if (id) resolved.push(id);
      else unknown.push(part);
    }

    if (unknown.length > 0) {
      return fail(raw, `No matching item found for: ${unknown.join(', ')}.`);
    }
    if (!multiple) return ok(resolved[0] ?? null);
    return ok(resolved.length ? resolved : null);
  },
  validate: () => null,
  format: (value) => (Array.isArray(value) ? value.join(', ') : value ? String(value) : ''),
  isEmpty: isBlank,
};

export const FIELD_TYPE_HANDLERS: Record<FieldType, FieldTypeHandler> = {
  text: textHandler,
  long_text: longTextHandler,
  number: numberHandler,
  currency: currencyHandler,
  percent: percentHandler,
  date: dateHandler,
  datetime: dateTimeHandler,
  select: selectHandler,
  multi_select: multiSelectHandler,
  checkbox: checkboxHandler,
  url: urlHandler,
  email: emailHandler,
  user: userHandler,
  relation: relationHandler,
};

export function handlerFor(type: FieldType): FieldTypeHandler {
  return FIELD_TYPE_HANDLERS[type];
}

export function coerceValue(
  type: FieldType,
  raw: unknown,
  config: FieldConfig,
  ctx?: CoerceContext,
): CoerceResult {
  const handler = handlerFor(type);
  const coerced = handler.coerce(raw, config, ctx);
  if (!coerced.ok) return coerced;
  const message = handler.validate(coerced.value, config);
  if (message) return fail(raw, message);
  return coerced;
}

export function formatValue(type: FieldType, value: unknown, config: FieldConfig): string {
  return handlerFor(type).format(value, config);
}

export function indexColumnFor(type: FieldType, config: FieldConfig): IndexColumn {
  return handlerFor(type).indexColumn(config);
}

/** Default mapping ignoring config, for schema-level documentation and tests. */
export function defaultIndexColumnFor(type: FieldType): IndexColumn {
  return INDEX_COLUMN_BY_TYPE[type];
}

/**
 * Splits a canonical value into the typed `item_field_index` columns.
 * `column: null` means the value is empty and no index row should exist.
 */
export function toIndexValue(type: FieldType, value: unknown, config: FieldConfig): IndexValue {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    return { column: null };
  }
  const column = indexColumnFor(type, config);
  switch (column) {
    case 'text':
      return { column, valueText: String(value) };
    case 'number':
      return { column, valueNumber: Number(value) };
    case 'date': {
      const dt = new Date(type === 'date' ? `${String(value)}T00:00:00.000Z` : String(value));
      return Number.isNaN(dt.getTime()) ? { column: null } : { column, valueDate: dt };
    }
    case 'bool':
      return { column, valueBool: Boolean(value) };
    case 'uuid':
      return { column, valueUuid: String(value) };
    case 'text_array':
      return {
        column,
        valueTextArray: Array.isArray(value) ? value.map(String) : [String(value)],
      };
    default:
      return { column: null };
  }
}

export { parseNumberLoose, parseDateLoose };
