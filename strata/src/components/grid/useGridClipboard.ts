'use client';

/**
 * Clipboard interop with Excel, Google Sheets, and Numbers.
 *
 * **TSV is not one format.** Each application quotes, escapes, and terminates
 * lines differently, and macOS and Windows disagree about line endings on top
 * of that. The parser below is written against what those applications
 * actually emit rather than against a tidy specification:
 *
 *  - Excel (Windows) uses CRLF between rows and quotes any cell containing a
 *    tab, newline, or double quote, doubling interior quotes.
 *  - Excel (macOS) historically emits CR alone between rows.
 *  - Google Sheets emits LF and quotes more sparingly.
 *  - Numbers emits LF and does not quote leading/trailing spaces.
 *  - A single cell copied from any of them may arrive with a trailing newline
 *    that must not become a second, empty row.
 *
 * Copying writes both `text/plain` (TSV) and `text/html` (a table), because
 * pasting into Word, Slack, or Google Docs picks up the HTML flavour and a
 * plain-text-only copy lands there as an unreadable run of tabs.
 */

import { useCallback } from 'react';
import type { Field } from '@/server/db/schema/itemTypes';
import { formatValue } from '@/server/validation/fieldTypes';

export type Matrix = string[][];

/**
 * Parses clipboard text into a rectangular matrix.
 *
 * Rows are padded to the widest row: a ragged paste from a spreadsheet with
 * trailing empty cells would otherwise map columns inconsistently row to row.
 */
export function parseTsv(text: string): Matrix {
  if (text === '') return [[]];

  const rows: Matrix = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  const pushCell = (): void => {
    row.push(cell);
    cell = '';
  };
  const pushRow = (): void => {
    pushCell();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i] as string;

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted cell is a literal quote.
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += char;
      i += 1;
      continue;
    }

    if (char === '"' && cell === '') {
      inQuotes = true;
      i += 1;
      continue;
    }

    if (char === '\t') {
      pushCell();
      i += 1;
      continue;
    }

    if (char === '\r') {
      // CRLF (Windows Excel) and lone CR (classic macOS) both end a row.
      pushRow();
      i += text[i + 1] === '\n' ? 2 : 1;
      continue;
    }

    if (char === '\n') {
      pushRow();
      i += 1;
      continue;
    }

    cell += char;
    i += 1;
  }

  // Whatever is buffered when the text ends is a final cell — unless the text
  // ended on a row terminator, in which case there is no trailing empty row.
  if (cell !== '' || row.length > 0) pushRow();

  const width = rows.reduce((max, r) => Math.max(max, r.length), 0);
  return rows.map((r) => {
    const padded = [...r];
    while (padded.length < width) padded.push('');
    return padded;
  });
}

/** Serialises a matrix to TSV using the quoting rules Excel expects back. */
export function toTsv(matrix: Matrix): string {
  return matrix
    .map((row) =>
      row
        .map((cell) => {
          if (/[\t\n\r"]/.test(cell)) return `"${cell.replaceAll('"', '""')}"`;
          return cell;
        })
        .join('\t'),
    )
    .join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export function toHtmlTable(matrix: Matrix): string {
  const rows = matrix
    .map((row) => `<tr>${row.map((c) => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`)
    .join('');
  return `<table>${rows}</table>`;
}

export interface ClipboardBridge {
  copy: (matrix: Matrix) => Promise<void>;
  read: () => Promise<Matrix>;
}

/**
 * Formats the selected cells for the clipboard.
 *
 * Values go out **formatted, not raw**: a `select` copies its label, not its
 * option id, and a currency copies "1,250.00" rather than 1250. The person
 * pasting into Excel wants what they see on screen; the option id would be an
 * opaque token that no longer round-trips through anything they understand.
 * Coercion on the way back in resolves labels to ids again.
 */
export function buildCopyMatrix(
  rows: ReadonlyArray<Record<string, unknown>>,
  fields: ReadonlyArray<Pick<Field, 'key' | 'type' | 'config'>>,
): Matrix {
  return rows.map((row) =>
    fields.map((field) => {
      if (field.key === '$title') return String(row.title ?? '');
      const value = (row.effectiveValues as Record<string, unknown> | undefined)?.[field.key];
      if (value === null || value === undefined) return '';
      return formatValue(field.type, value, field.config);
    }),
  );
}

export function useGridClipboard(): ClipboardBridge {
  const copy = useCallback(async (matrix: Matrix) => {
    const tsv = toTsv(matrix);
    const html = toHtmlTable(matrix);

    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([tsv], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ]);
        return;
      } catch {
        // Safari rejects async clipboard writes outside a user gesture and
        // Firefox has historically not supported ClipboardItem at all. Falling
        // back to text-only is worse than both flavours but far better than
        // copy silently doing nothing.
      }
    }

    await navigator.clipboard.writeText(tsv);
  }, []);

  const read = useCallback(async (): Promise<Matrix> => {
    // `readText` is the only reliably-permitted read across browsers; the HTML
    // flavour needs a permission Firefox does not grant, and the TSV flavour
    // carries everything we need anyway.
    const text = await navigator.clipboard.readText();
    return parseTsv(text);
  }, []);

  return { copy, read };
}

/**
 * Maps a pasted matrix onto a selection rectangle.
 *
 * Follows the spreadsheet convention users already have in their fingers:
 *
 *  - Pasting a block into a single selected cell expands from that cell.
 *  - Pasting a block into a larger selection *tiles* it, so copying one cell
 *    and selecting 300 fills all 300 — the single most common bulk edit there
 *    is, and the one people are most surprised to lose.
 *  - Pasting is clipped at the grid's edges rather than growing it; silently
 *    creating rows off the end of a filtered view is not recoverable by Ctrl+Z
 *    in a way that matches what the user thought they did.
 */
export function mapPasteToTargets(
  matrix: Matrix,
  selection: { top: number; bottom: number; left: number; right: number },
  bounds: { rows: number; cols: number },
): Array<{ row: number; col: number; value: string }> {
  const sourceRows = matrix.length;
  const sourceCols = matrix[0]?.length ?? 0;
  if (sourceRows === 0 || sourceCols === 0) return [];

  const selRows = selection.bottom - selection.top + 1;
  const selCols = selection.right - selection.left + 1;

  const tile = selRows > sourceRows || selCols > sourceCols;
  const targetRows = tile ? selRows : sourceRows;
  const targetCols = tile ? selCols : sourceCols;

  const out: Array<{ row: number; col: number; value: string }> = [];

  for (let r = 0; r < targetRows; r += 1) {
    const row = selection.top + r;
    if (row >= bounds.rows) break;
    for (let c = 0; c < targetCols; c += 1) {
      const col = selection.left + c;
      if (col >= bounds.cols) break;
      const value = matrix[r % sourceRows]?.[c % sourceCols] ?? '';
      out.push({ row, col, value });
    }
  }

  return out;
}
