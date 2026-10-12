/**
 * Clipboard TSV parsing.
 *
 * The fixtures below are the byte shapes Excel, Google Sheets, and Numbers
 * actually put on the clipboard, not idealised TSV. CLAUDE.md is explicit that
 * this is where the feature lives or dies, and the differences are exactly the
 * kind that a hand-written fixture would paper over: CRLF vs LF vs lone CR,
 * when each app quotes, and what a single-cell copy looks like.
 *
 * **This does not replace testing against the real applications.** No headless
 * environment can put an actual Excel clipboard payload on the board, so
 * Step 7e's manual check against real Excel and real Google Sheets on both
 * macOS and Windows remains outstanding — these tests pin the parser against
 * the formats, not against the integration.
 */

import { describe, expect, it } from 'vitest';
import { mapPasteToTargets, parseTsv, toTsv } from '@/components/grid/useGridClipboard';

describe('parseTsv', () => {
  it('parses a plain LF block (Google Sheets, Numbers)', () => {
    expect(parseTsv('a\tb\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('parses CRLF rows (Excel on Windows)', () => {
    expect(parseTsv('a\tb\r\nc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('parses lone CR rows (classic Excel on macOS)', () => {
    expect(parseTsv('a\tb\rc\td')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('does not invent a trailing empty row from a terminating newline', () => {
    // Excel appends a row terminator after the last row. Treating it as a row
    // would clear one extra row of the user's data on every paste.
    expect(parseTsv('a\tb\r\n')).toEqual([['a', 'b']]);
    expect(parseTsv('a\tb\n')).toEqual([['a', 'b']]);
  });

  it('handles a single cell with no separators at all', () => {
    expect(parseTsv('hello')).toEqual([['hello']]);
  });

  it('preserves genuinely empty trailing cells', () => {
    expect(parseTsv('a\t\tc')).toEqual([['a', '', 'c']]);
  });

  it('unquotes a cell containing a tab', () => {
    expect(parseTsv('"has\ttab"\tb')).toEqual([['has\ttab', 'b']]);
  });

  it('unquotes a cell containing a newline', () => {
    expect(parseTsv('"line one\nline two"\tb')).toEqual([['line one\nline two', 'b']]);
  });

  it('collapses doubled quotes inside a quoted cell', () => {
    expect(parseTsv('"she said ""hi"""\tb')).toEqual([['she said "hi"', 'b']]);
  });

  it('treats a quote in the middle of an unquoted cell as literal', () => {
    // Numbers does not quote a cell just because it contains an apostrophe or
    // a stray double quote; treating it as an opening quote swallows the row.
    expect(parseTsv('5" pipe\tb')).toEqual([['5" pipe', 'b']]);
  });

  it('pads ragged rows to a rectangle', () => {
    // A spreadsheet range whose last column is empty on some rows arrives
    // ragged; unpadded rows would map columns inconsistently row to row.
    expect(parseTsv('a\tb\tc\nd\te')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', ''],
    ]);
  });

  it('round-trips through toTsv', () => {
    const matrix = [
      ['plain', 'has\ttab'],
      ['has "quotes"', 'has\nnewline'],
    ];
    expect(parseTsv(toTsv(matrix))).toEqual(matrix);
  });
});

describe('mapPasteToTargets', () => {
  const bounds = { rows: 100, cols: 10 };

  it('expands from a single selected cell', () => {
    const targets = mapPasteToTargets(
      [
        ['1', '2'],
        ['3', '4'],
      ],
      { top: 5, bottom: 5, left: 2, right: 2 },
      bounds,
    );
    expect(targets).toEqual([
      { row: 5, col: 2, value: '1' },
      { row: 5, col: 3, value: '2' },
      { row: 6, col: 2, value: '3' },
      { row: 6, col: 3, value: '4' },
    ]);
  });

  it('tiles one copied cell across a larger selection', () => {
    // The single most common bulk edit: copy one cell, select 300, paste.
    const targets = mapPasteToTargets([['x']], { top: 0, bottom: 2, left: 0, right: 1 }, bounds);
    expect(targets).toHaveLength(6);
    expect(targets.every((t) => t.value === 'x')).toBe(true);
  });

  it('tiles a block that divides the selection', () => {
    const targets = mapPasteToTargets(
      [['a'], ['b']],
      { top: 0, bottom: 3, left: 0, right: 0 },
      bounds,
    );
    expect(targets.map((t) => t.value)).toEqual(['a', 'b', 'a', 'b']);
  });

  it('clips at the grid edges rather than growing the grid', () => {
    const targets = mapPasteToTargets(
      [
        ['a', 'b', 'c'],
        ['d', 'e', 'f'],
      ],
      { top: 99, bottom: 99, left: 9, right: 9 },
      bounds,
    );
    // Only the top-left cell fits inside a 100x10 grid at (99, 9).
    expect(targets).toEqual([{ row: 99, col: 9, value: 'a' }]);
  });

  it('returns nothing for an empty clipboard', () => {
    expect(mapPasteToTargets([[]], { top: 0, bottom: 0, left: 0, right: 0 }, bounds)).toEqual([]);
  });
});
