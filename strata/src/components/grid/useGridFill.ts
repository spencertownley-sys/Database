'use client';

/**
 * Fill-down (Ctrl/Cmd+D) and fill-handle drag.
 *
 * Increment detection matches what a spreadsheet does, because that is the
 * behaviour users already expect: dragging `1, 2` extends `3, 4, 5`, dragging
 * a single `1` repeats it, and dragging `Q1 2026` extends `Q2 2026`. Getting
 * this wrong in either direction is annoying; getting it wrong *silently* on a
 * 300-row drag is a data error the user will not notice until much later, so
 * the detection is deliberately conservative — when in doubt, repeat.
 */

import type { FieldType } from '@/types/fields';

export interface FillSource {
  /** Values in the source selection, in row order. */
  values: string[];
  type: FieldType;
}

const TRAILING_NUMBER = /^(.*?)(-?\d+)(\D*)$/;

function detectNumericStep(values: readonly string[]): number | null {
  if (values.length < 2) return null;
  const numbers = values.map((v) => Number(v.replace(/[,\s]/g, '')));
  if (numbers.some((n) => !Number.isFinite(n))) return null;

  const step = (numbers[1] as number) - (numbers[0] as number);
  for (let i = 2; i < numbers.length; i += 1) {
    if ((numbers[i] as number) - (numbers[i - 1] as number) !== step) return null;
  }
  return step;
}

function detectDateStep(values: readonly string[]): number | null {
  if (values.length < 2) return null;
  const times = values.map((v) => new Date(v).getTime());
  if (times.some((t) => Number.isNaN(t))) return null;

  const step = (times[1] as number) - (times[0] as number);
  if (step === 0) return null;
  for (let i = 2; i < times.length; i += 1) {
    if ((times[i] as number) - (times[i - 1] as number) !== step) return null;
  }
  return step;
}

/** `Q1 2026` / `Item 4` — a trailing integer inside otherwise stable text. */
function detectSuffixStep(values: readonly string[]): { prefix: string; suffix: string; start: number; step: number } | null {
  if (values.length < 2) return null;

  const parsed = values.map((v) => TRAILING_NUMBER.exec(v));
  if (parsed.some((m) => m === null)) return null;

  const first = parsed[0] as RegExpExecArray;
  const prefix = first[1] as string;
  const suffix = first[3] as string;
  if (parsed.some((m) => (m as RegExpExecArray)[1] !== prefix || (m as RegExpExecArray)[3] !== suffix)) {
    return null;
  }

  const numbers = parsed.map((m) => Number((m as RegExpExecArray)[2]));
  const step = (numbers[1] as number) - (numbers[0] as number);
  for (let i = 2; i < numbers.length; i += 1) {
    if ((numbers[i] as number) - (numbers[i - 1] as number) !== step) return null;
  }
  return { prefix, suffix, start: numbers[numbers.length - 1] as number, step };
}

/**
 * Produces `count` values continuing the source pattern.
 *
 * Falls back to repeating the source cyclically — which is both what a
 * spreadsheet does for non-numeric data and the safe answer when a pattern is
 * ambiguous.
 */
export function extendFill(source: FillSource, count: number): string[] {
  const { values, type } = source;
  if (values.length === 0 || count <= 0) return [];

  const numericTypes: ReadonlySet<FieldType> = new Set(['number', 'currency', 'percent']);
  if (numericTypes.has(type)) {
    const step = detectNumericStep(values);
    if (step !== null) {
      const last = Number((values[values.length - 1] as string).replace(/[,\s]/g, ''));
      return Array.from({ length: count }, (_, i) => String(last + step * (i + 1)));
    }
  }

  if (type === 'date' || type === 'datetime') {
    const step = detectDateStep(values);
    if (step !== null) {
      const last = new Date(values[values.length - 1] as string).getTime();
      return Array.from({ length: count }, (_, i) => {
        const next = new Date(last + step * (i + 1));
        return type === 'date' ? (next.toISOString().slice(0, 10) as string) : next.toISOString();
      });
    }
  }

  if (type === 'text' || type === 'long_text') {
    const pattern = detectSuffixStep(values);
    if (pattern) {
      return Array.from(
        { length: count },
        (_, i) => `${pattern.prefix}${pattern.start + pattern.step * (i + 1)}${pattern.suffix}`,
      );
    }
  }

  return Array.from({ length: count }, (_, i) => values[i % values.length] as string);
}

/** Fill-down: every row in the selection takes the top row's value. */
export function fillDownTargets(
  rect: { top: number; bottom: number; left: number; right: number },
  valueAt: (row: number, col: number) => string,
): Array<{ row: number; col: number; value: string }> {
  const out: Array<{ row: number; col: number; value: string }> = [];
  for (let col = rect.left; col <= rect.right; col += 1) {
    const seed = valueAt(rect.top, col);
    for (let row = rect.top + 1; row <= rect.bottom; row += 1) {
      out.push({ row, col, value: seed });
    }
  }
  return out;
}

/** Fill-handle drag: extend the source rectangle down to `toRow`. */
export function fillHandleTargets(
  rect: { top: number; bottom: number; left: number; right: number },
  toRow: number,
  columnType: (col: number) => FieldType,
  valueAt: (row: number, col: number) => string,
): Array<{ row: number; col: number; value: string }> {
  if (toRow <= rect.bottom) return [];
  const out: Array<{ row: number; col: number; value: string }> = [];
  const count = toRow - rect.bottom;

  for (let col = rect.left; col <= rect.right; col += 1) {
    const source: string[] = [];
    for (let row = rect.top; row <= rect.bottom; row += 1) source.push(valueAt(row, col));
    const extended = extendFill({ values: source, type: columnType(col) }, count);
    extended.forEach((value, i) => out.push({ row: rect.bottom + 1 + i, col, value }));
  }

  return out;
}
