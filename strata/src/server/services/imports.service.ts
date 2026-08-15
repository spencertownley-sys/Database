/**
 * CSV import — upload → map → dry-run → commit, always through one change set.
 *
 * Three rules from the PRD carry this file:
 *
 *  1. **The dry-run is the product.** Validation happens before commit and
 *     produces a per-column report plus a downloadable error CSV; nothing is
 *     written to items until the user has seen what will happen (§6.4).
 *
 *  2. **Validation never blocks the save.** A cell that will not coerce goes
 *     to `invalid_values` on its item and the rest of the row commits — the
 *     report says so up front rather than failing the import.
 *
 *  3. **One import, one change set.** Creates and match-key updates land in a
 *     single change set, so `POST /change-sets/:id/undo` reverts the whole
 *     import exactly like any other bulk edit.
 *
 * The Tech Spec runs parse/validate/commit in Inngest jobs; this build has no
 * job runner, so they run synchronously — same states, same shapes, no queue.
 * XLSX needs a parser this build does not carry: CSV only, said plainly at
 * upload rather than discovered at parse.
 */

import Papa from 'papaparse';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '@/server/db';
import {
  importJobs,
  importProfiles,
  type ImportJob,
  type ImportOptions,
  type ImportProfile,
  type ImportReport,
} from '@/server/db/schema/imports';
import { items } from '@/server/db/schema/items';
import { fields as fieldsTable, itemTypes, type Field } from '@/server/db/schema/itemTypes';
import type { ItemDraft } from '@/server/db/schema/changeSets';
import { AppError } from '@/server/lib/errors';
import { getFile, putFile } from '@/server/lib/storage';
import { coerceValue } from '@/server/validation/fieldTypes';
import { buildCoerceContext } from './changeSets.service';

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
/**
 * The env default is 50k, but an import is one change set and change sets cap
 * at 10k entries (API Design §5) — the smaller bound wins so the commit the
 * dry-run promised is the commit that happens.
 */
export const MAX_IMPORT_ROWS = Math.min(Number(process.env.MAX_IMPORT_ROWS ?? 50_000), 10_000);
const PREVIEW_ROWS = 20;
const MAX_REPORTED_ERRORS = 1_000;

// ---------------------------------------------------------------------------
// upload + parse
// ---------------------------------------------------------------------------

const CSV_EXTENSIONS = new Set(['csv', 'tsv', 'txt']);

function assertLooksLikeCsv(fileName: string, content: Buffer): void {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'xlsx' || ext === 'xls' || content.subarray(0, 2).toString('latin1') === 'PK') {
    throw new AppError(
      'UNSUPPORTED_FILE_TYPE',
      'This build imports CSV only. In Excel: File → Save As → CSV UTF-8, then upload that.',
    );
  }
  if (!CSV_EXTENSIONS.has(ext)) {
    throw new AppError('UNSUPPORTED_FILE_TYPE', 'Upload a .csv file.');
  }
  // Magic-byte check: text files have no NUL bytes; anything binary does
  // within the first few hundred, whatever its extension claims.
  const probe = content.subarray(0, 512);
  if (probe.includes(0)) {
    throw new AppError('UNSUPPORTED_FILE_TYPE', 'That file is not a text CSV.');
  }
}

function parseCsv(content: Buffer, delimiter?: string): string[][] {
  const result = Papa.parse<string[]>(content.toString('utf8').replace(/^﻿/, ''), {
    delimiter: delimiter ?? '',
    skipEmptyLines: 'greedy',
  });
  return result.data;
}

// ---------------------------------------------------------------------------
// fuzzy header → field suggestions
// ---------------------------------------------------------------------------

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** 0..1 similarity: exact > synonym > containment > token overlap. */
function similarity(header: string, candidate: string): number {
  const h = normalize(header);
  const c = normalize(candidate);
  if (!h || !c) return 0;
  if (h === c) return 1;
  if (h.replace(/ /g, '') === c.replace(/ /g, '')) return 0.97;
  if (c.includes(h) || h.includes(c)) return 0.8;
  const ht = new Set(h.split(' '));
  const ct = new Set(c.split(' '));
  const shared = [...ht].filter((t) => ct.has(t)).length;
  if (shared === 0) return 0;
  return 0.4 + 0.35 * (shared / Math.max(ht.size, ct.size));
}

const TITLE_SYNONYMS = ['title', 'name', 'item', 'subject'];

export interface ColumnSuggestion {
  index: number;
  name: string;
  samples: string[];
  suggestedFieldKey: string | null;
  confidence: number;
}

export function suggestMappings(
  headers: readonly string[],
  fields: ReadonlyArray<Pick<Field, 'key' | 'label'>>,
  sampleRows: readonly string[][],
  /** Extra title synonyms — the item type's own label ("Task", "Campaign"). */
  titleHints: readonly string[] = [],
): ColumnSuggestion[] {
  const taken = new Set<string>();

  return headers.map((name, index) => {
    let best: { key: string; score: number } | null = null;

    for (const synonym of [...TITLE_SYNONYMS, ...titleHints]) {
      const score = similarity(name, synonym) * (synonym === 'title' ? 1 : 0.94);
      if (score > (best?.score ?? 0)) best = { key: 'title', score };
    }
    for (const field of fields) {
      const score = Math.max(similarity(name, field.key), similarity(name, field.label));
      if (score > (best?.score ?? 0)) best = { key: field.key, score };
    }

    const suggested = best && best.score >= 0.55 && !taken.has(best.key) ? best : null;
    if (suggested) taken.add(suggested.key);

    return {
      index,
      name,
      samples: sampleRows
        .map((row) => row[index] ?? '')
        .filter((v) => v !== '')
        .slice(0, 3),
      suggestedFieldKey: suggested?.key ?? null,
      confidence: suggested ? Math.round(suggested.score * 100) / 100 : 0,
    };
  });
}

// ---------------------------------------------------------------------------
// job lifecycle
// ---------------------------------------------------------------------------

async function loadJob(tx: Tx, workspaceId: string, jobId: string): Promise<ImportJob> {
  const [job] = await tx
    .select()
    .from(importJobs)
    .where(and(eq(importJobs.workspaceId, workspaceId), eq(importJobs.id, jobId)))
    .limit(1);
  if (!job) throw new AppError('NOT_FOUND', 'That import no longer exists.');
  return job;
}

export async function createImportJob(
  tx: Tx,
  workspaceId: string,
  userId: string | null,
  input: {
    itemTypeId: string;
    profileId?: string | null;
    fileName: string;
    mimeType: string | null;
    content: Buffer;
  },
): Promise<{ job: ImportJob; detectedColumns: ColumnSuggestion[] }> {
  if (input.content.byteLength > MAX_IMPORT_BYTES) {
    throw new AppError('PAYLOAD_TOO_LARGE', 'Imports are capped at 50MB. Split the file.');
  }
  assertLooksLikeCsv(input.fileName, input.content);

  let profile: ImportProfile | null = null;
  if (input.profileId) {
    const [row] = await tx
      .select()
      .from(importProfiles)
      .where(and(eq(importProfiles.workspaceId, workspaceId), eq(importProfiles.id, input.profileId)))
      .limit(1);
    if (!row) throw new AppError('NOT_FOUND', 'That import profile no longer exists.');
    if (row.itemTypeId !== input.itemTypeId) {
      throw new AppError('VALIDATION_ERROR', 'That profile belongs to a different item type.');
    }
    profile = row;
  }

  const rows = parseCsv(input.content, profile?.options.delimiter);
  if (rows.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'The file has no rows.');
  }
  const hasHeader = profile?.options.hasHeaderRow ?? true;
  const headers = hasHeader
    ? (rows[0] as string[]).map((h, i) => (h.trim() === '' ? `Column ${i + 1}` : h.trim()))
    : (rows[0] as string[]).map((_, i) => `Column ${i + 1}`);
  const dataRows = hasHeader ? rows.slice(1) : rows;

  if (dataRows.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'The file has a header but no data rows.');
  }
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new AppError(
      'PAYLOAD_TOO_LARGE',
      `Imports are capped at ${MAX_IMPORT_ROWS.toLocaleString()} rows; this file has ${dataRows.length.toLocaleString()}.`,
    );
  }

  const jobId = crypto.randomUUID();
  const storagePath = `imports/${workspaceId}/${jobId}/source.csv`;
  await putFile(storagePath, input.content);

  const fields = await tx
    .select()
    .from(fieldsTable)
    .where(
      and(
        eq(fieldsTable.workspaceId, workspaceId),
        eq(fieldsTable.itemTypeId, input.itemTypeId),
      ),
    );
  const live = fields.filter((f) => f.deletedAt === null);
  const preview = dataRows.slice(0, PREVIEW_ROWS);

  const [type] = await tx
    .select({ label: itemTypes.label, pluralLabel: itemTypes.pluralLabel })
    .from(itemTypes)
    .where(and(eq(itemTypes.workspaceId, workspaceId), eq(itemTypes.id, input.itemTypeId)))
    .limit(1);
  if (!type) throw new AppError('NOT_FOUND', 'That item type no longer exists.');

  // A column named after the type itself ("Task", "Campaigns") is the title.
  const titleHints = [type.label, type.pluralLabel].filter((s): s is string => Boolean(s));
  const detectedColumns = suggestMappings(headers, live, preview, titleHints);

  const [job] = await tx
    .insert(importJobs)
    .values({
      id: jobId,
      workspaceId,
      itemTypeId: input.itemTypeId,
      profileId: profile?.id ?? null,
      status: 'mapping',
      fileName: input.fileName,
      fileSize: input.content.byteLength,
      storagePath,
      mimeType: input.mimeType,
      mapping: profile?.mapping ?? {},
      matchKey: profile?.matchKey ?? null,
      options: profile?.options ?? { hasHeaderRow: true },
      detectedHeaders: headers,
      previewRows: preview,
      rowCount: dataRows.length,
      createdBy: userId,
    })
    .returning();
  if (!job) throw new AppError('INTERNAL_ERROR', 'The import was not created.');
  return { job, detectedColumns };
}

// ---------------------------------------------------------------------------
// mapping + dry run
// ---------------------------------------------------------------------------

interface ParsedFile {
  headers: string[];
  dataRows: string[][];
}

async function readJobFile(job: ImportJob): Promise<ParsedFile> {
  const rows = parseCsv(await getFile(job.storagePath), job.options.delimiter);
  const hasHeader = job.options.hasHeaderRow ?? true;
  const headers = job.detectedHeaders ?? [];
  return { headers, dataRows: hasHeader ? rows.slice(1) : rows };
}

/**
 * Reverses the export-side injection guard, like Excel does on display: a
 * leading `'` in front of `=`, `+`, `-`, or `@` is armor, not data. Without
 * this, an exported `-2` re-imports as the unparseable text `'-2`.
 */
function unguardCsvCell(raw: string): string {
  return /^'[=+\-@]/.test(raw) ? raw.slice(1) : raw;
}

/** Builds `{title, values}` for one row through the column mapping. */
function rowToPatch(
  row: readonly string[],
  headers: readonly string[],
  mapping: Record<string, string>,
): { title: string; values: Record<string, unknown> } {
  let title = '';
  const values: Record<string, unknown> = {};
  headers.forEach((header, i) => {
    const target = mapping[header];
    if (!target || target === '$skip') return;
    const raw = unguardCsvCell((row[i] ?? '').trim());
    if (target === 'title') {
      title = raw;
      return;
    }
    if (raw !== '') values[target] = raw;
  });
  return { title, values };
}

/**
 * Loads `matchKey value → item id` for every live item of the type, one query.
 * Title matches on the title column; field keys match on `values`.
 */
async function buildMatchIndex(
  tx: Tx,
  workspaceId: string,
  itemTypeId: string,
  matchKey: string,
): Promise<Map<string, string>> {
  const rows = await tx
    .select({ id: items.id, title: items.title, values: items.values })
    .from(items)
    .where(and(eq(items.workspaceId, workspaceId), eq(items.itemTypeId, itemTypeId)));

  const index = new Map<string, string>();
  for (const row of rows) {
    const value =
      matchKey === 'title' ? row.title : ((row.values as Record<string, unknown>)[matchKey] ?? '');
    const key = String(value ?? '').trim().toLowerCase();
    // First occurrence wins; a duplicate match value makes matching ambiguous
    // and the import will update the first item it saw, which the report shows.
    if (key !== '' && !index.has(key)) index.set(key, row.id);
  }
  return index;
}

export async function setMappingAndValidate(
  tx: Tx,
  workspaceId: string,
  userId: string | null,
  jobId: string,
  input: {
    mapping: Record<string, string>;
    matchKey?: string | null;
    options?: Partial<ImportOptions>;
    saveAsProfile?: string;
  },
): Promise<ImportJob> {
  const job = await loadJob(tx, workspaceId, jobId);
  if (job.status === 'committed' || job.status === 'committing') {
    throw new AppError('CONFLICT', 'This import has already been committed.');
  }

  const fields = await loadFields(tx, workspaceId, job.itemTypeId);
  const fieldByKey = new Map(fields.map((f) => [f.key, f]));
  const headers = job.detectedHeaders ?? [];

  for (const [source, target] of Object.entries(input.mapping)) {
    if (!headers.includes(source)) {
      throw new AppError('VALIDATION_ERROR', `"${source}" is not a column of this file.`);
    }
    if (target !== 'title' && target !== '$skip' && !fieldByKey.has(target)) {
      throw new AppError('VALIDATION_ERROR', `"${target}" is not a field of this item type.`);
    }
  }

  const mappedTargets = new Set(Object.values(input.mapping));
  const matchKey = input.matchKey ?? null;
  if (matchKey && matchKey !== 'title' && !fieldByKey.has(matchKey)) {
    throw new AppError('VALIDATION_ERROR', 'The match key must be the title or a mapped field.');
  }
  if (!mappedTargets.has('title') && !matchKey) {
    throw new AppError(
      'VALIDATION_ERROR',
      'Map a column to the title, or set a match key — otherwise every row would be a blank item.',
    );
  }

  const options: ImportOptions = { ...job.options, ...(input.options ?? {}) };

  // ---- dry run --------------------------------------------------------------
  const { dataRows } = await readJobFile(job);
  const coerceCtx = await buildCoerceContext(tx, workspaceId);
  const matchIndex = matchKey
    ? await buildMatchIndex(tx, workspaceId, job.itemTypeId, matchKey)
    : null;

  const columnStats = new Map<
    string,
    { fieldKey: string | null; coerced: number; invalid: number; empty: number; samples: string[] }
  >();
  for (const header of headers) {
    const target = input.mapping[header];
    columnStats.set(header, {
      fieldKey: target && target !== '$skip' ? target : null,
      coerced: 0,
      invalid: 0,
      empty: 0,
      samples: [],
    });
  }

  const errors: ImportReport['errors'] = [];
  let newCount = 0;
  let matchedCount = 0;

  dataRows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + ((job.options.hasHeaderRow ?? true) ? 2 : 1);
    headers.forEach((header, i) => {
      const stats = columnStats.get(header);
      const target = input.mapping[header];
      if (!stats || !target || target === '$skip') return;
      const raw = (row[i] ?? '').trim();
      if (raw === '') {
        stats.empty += 1;
        return;
      }
      if (stats.samples.length < 3) stats.samples.push(raw);
      if (target === 'title') return;

      const field = fieldByKey.get(target);
      if (!field) return;
      const result = coerceValue(field.type, raw, field.config, coerceCtx);
      if (!result.ok) {
        stats.invalid += 1;
        if (errors.length < MAX_REPORTED_ERRORS) {
          errors.push({ row: rowNumber, column: header, value: raw, message: result.message });
        }
      } else if (String(result.value) !== raw) {
        stats.coerced += 1;
      }
    });

    if (matchIndex) {
      const { title, values } = rowToPatch(row, headers, input.mapping);
      const matchValue =
        matchKey === 'title' ? title : String(values[matchKey as string] ?? '');
      if (matchValue.trim() !== '' && matchIndex.has(matchValue.trim().toLowerCase())) {
        matchedCount += 1;
      } else {
        newCount += 1;
      }
    } else {
      newCount += 1;
    }
  });

  const report: ImportReport = {
    rowCount: dataRows.length,
    newCount,
    matchedCount,
    columns: headers.map((header) => {
      const stats = columnStats.get(header);
      return {
        header,
        fieldKey: stats?.fieldKey ?? null,
        coerced: stats?.coerced ?? 0,
        invalid: stats?.invalid ?? 0,
        empty: stats?.empty ?? 0,
        samples: stats?.samples ?? [],
      };
    }),
    errors,
  };

  let errorCsvPath: string | null = null;
  if (errors.length > 0) {
    errorCsvPath = `imports/${workspaceId}/${job.id}/errors.csv`;
    const csv = Papa.unparse({
      fields: ['row', 'column', 'value', 'message'],
      data: errors.map((e) => [String(e.row), e.column, guardCsvCell(e.value), e.message]),
    });
    await putFile(errorCsvPath, csv);
  }

  if (input.saveAsProfile) {
    await tx
      .insert(importProfiles)
      .values({
        workspaceId,
        itemTypeId: job.itemTypeId,
        name: input.saveAsProfile,
        mapping: input.mapping,
        matchKey,
        options,
        createdBy: userId,
      })
      .onConflictDoUpdate({
        target: [importProfiles.workspaceId, importProfiles.itemTypeId, importProfiles.name],
        set: { mapping: input.mapping, matchKey, options, updatedAt: new Date() },
      });
  }

  const [updated] = await tx
    .update(importJobs)
    .set({
      status: 'validated',
      mapping: input.mapping,
      matchKey,
      options,
      newCount,
      matchedCount,
      errorCount: errors.length,
      warningCount: report.columns.reduce((n, c) => n + c.coerced, 0),
      report,
      errorCsvPath,
      updatedAt: new Date(),
    })
    .where(eq(importJobs.id, job.id))
    .returning();
  if (!updated) throw new AppError('INTERNAL_ERROR', 'The import vanished mid-update.');
  return updated;
}

/** Drafts for the commit — one per row, updates carrying `matchItemId`. */
export async function buildImportDrafts(
  tx: Tx,
  workspaceId: string,
  job: ImportJob,
): Promise<ItemDraft[]> {
  if (job.status !== 'validated') {
    throw new AppError('CONFLICT', 'Validate the mapping before committing.');
  }
  const { dataRows } = await readJobFile(job);
  const headers = job.detectedHeaders ?? [];
  const matchIndex = job.matchKey
    ? await buildMatchIndex(tx, workspaceId, job.itemTypeId, job.matchKey)
    : null;
  const onMatch = job.options.onMatch ?? 'update';

  const drafts: ItemDraft[] = [];
  for (const row of dataRows) {
    const { title, values } = rowToPatch(row, headers, job.mapping);
    let matchItemId: string | undefined;
    if (matchIndex && job.matchKey) {
      const matchValue =
        job.matchKey === 'title' ? title : String(values[job.matchKey] ?? '');
      matchItemId = matchIndex.get(matchValue.trim().toLowerCase());
      if (matchItemId && onMatch === 'skip') continue;
    }
    if (!matchItemId && title.trim() === '') {
      // A row with no title and no match would create a nameless item; the
      // validation error report already counted its cells.
      continue;
    }
    drafts.push({
      // Empty on a matched update means "keep the existing title" — the plan
      // layer handles that; creates were filtered above.
      title,
      values,
      matchItemId,
      treeNodeIds: job.options.treeNodeId ? [job.options.treeNodeId] : undefined,
      parentId: job.options.parentItemId ?? undefined,
    });
  }
  if (drafts.length === 0) {
    throw new AppError('VALIDATION_ERROR', 'No importable rows — every row was empty or skipped.');
  }
  return drafts;
}

export async function markCommitted(
  tx: Tx,
  workspaceId: string,
  jobId: string,
  changeSetId: string,
): Promise<ImportJob> {
  const [updated] = await tx
    .update(importJobs)
    .set({ status: 'committed', changeSetId, completedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(importJobs.workspaceId, workspaceId), eq(importJobs.id, jobId)))
    .returning();
  if (!updated) throw new AppError('NOT_FOUND', 'That import no longer exists.');
  return updated;
}

export async function getImportJob(tx: Tx, workspaceId: string, jobId: string): Promise<ImportJob> {
  return loadJob(tx, workspaceId, jobId);
}

async function loadFields(tx: Tx, workspaceId: string, itemTypeId: string): Promise<Field[]> {
  const rows = await tx
    .select()
    .from(fieldsTable)
    .where(and(eq(fieldsTable.workspaceId, workspaceId), eq(fieldsTable.itemTypeId, itemTypeId)));
  return rows.filter((f) => f.deletedAt === null);
}

// ---------------------------------------------------------------------------
// profiles
// ---------------------------------------------------------------------------

export async function listProfiles(
  tx: Tx,
  workspaceId: string,
  itemTypeId?: string,
): Promise<ImportProfile[]> {
  return tx
    .select()
    .from(importProfiles)
    .where(
      and(
        eq(importProfiles.workspaceId, workspaceId),
        itemTypeId ? eq(importProfiles.itemTypeId, itemTypeId) : undefined,
      ),
    )
    .orderBy(importProfiles.name);
}

export async function deleteProfile(tx: Tx, workspaceId: string, id: string): Promise<void> {
  const deleted = await tx
    .delete(importProfiles)
    .where(and(eq(importProfiles.workspaceId, workspaceId), eq(importProfiles.id, id)))
    .returning({ id: importProfiles.id });
  if (deleted.length === 0) throw new AppError('NOT_FOUND', 'That profile no longer exists.');
}

// ---------------------------------------------------------------------------
// CSV injection guard (Tech Spec §7.2) — shared with exports
// ---------------------------------------------------------------------------

/** `=SUM(...)` in a cell becomes a formula in Excel; a leading `'` defuses it. */
export function guardCsvCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
