/**
 * CSV export — the current view, exactly as filtered and sorted, as a file.
 *
 * Two rules:
 *
 *  1. **The file matches the screen.** The query (filter, sort, search,
 *     visible fields) is snapshotted onto the job at request time, so the
 *     generated file cannot drift from what the user asked for.
 *
 *  2. **Every text cell goes through the injection guard** (Tech Spec §7.2).
 *     A cell starting with `=`, `+`, `-`, `@`, tab, or CR opens as a formula
 *     in Excel; a leading `'` defuses it and costs nothing.
 *
 * The Tech Spec queues exports > 5,000 rows through a job runner; this build
 * has none, so everything generates synchronously with a hard row cap. Values
 * are exported *formatted* (option labels, ISO dates, plain numbers) so the
 * file round-trips through the importer's coercion without loss.
 */

import Papa from 'papaparse';
import { and, eq, isNull } from 'drizzle-orm';
import type { Tx } from '@/server/db';
import { exportJobs, type ExportJob } from '@/server/db/schema/imports';
import { fields as fieldsTable, type Field } from '@/server/db/schema/itemTypes';
import { AppError } from '@/server/lib/errors';
import { putFile, signDownloadToken } from '@/server/lib/storage';
import { searchProvider } from '@/server/search/PostgresSearchProvider';
import { formatValue } from '@/server/validation/fieldTypes';
import type { FilterGroup, SortSpec } from '@/types/filters';
import { guardCsvCell } from './imports.service';

export const MAX_EXPORT_ROWS = 50_000;
const PAGE_SIZE = 500;
const DOWNLOAD_TTL_SECONDS = 3600;

export interface ExportRequest {
  itemTypeId: string;
  filter?: FilterGroup;
  sort?: SortSpec[];
  search?: string;
  incompleteOnly?: boolean;
  /** Field keys, in column order. Defaults to every live field. */
  visibleFieldKeys?: string[];
  includeVariants?: boolean;
}

export interface ExportResult {
  job: ExportJob;
  downloadUrl: string;
}

export async function runExport(
  tx: Tx,
  workspaceId: string,
  userId: string | null,
  request: ExportRequest,
): Promise<ExportResult> {
  const allFields = await tx
    .select()
    .from(fieldsTable)
    .where(
      and(
        eq(fieldsTable.workspaceId, workspaceId),
        eq(fieldsTable.itemTypeId, request.itemTypeId),
        isNull(fieldsTable.deletedAt),
      ),
    );
  if (allFields.length === 0) {
    throw new AppError('NOT_FOUND', 'That item type has no fields to export.');
  }

  let columns: Field[];
  if (request.visibleFieldKeys?.length) {
    const byKey = new Map(allFields.map((f) => [f.key, f]));
    columns = request.visibleFieldKeys
      .map((key) => byKey.get(key))
      .filter((f): f is Field => Boolean(f));
    if (columns.length === 0) {
      throw new AppError('VALIDATION_ERROR', 'None of the requested fields exist.');
    }
  } else {
    columns = [...allFields].sort((a, b) => a.position.localeCompare(b.position));
  }

  // Page through the same provider the grid uses — the file and the screen
  // cannot disagree about which rows match.
  const rows: string[][] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await searchProvider.search(tx, workspaceId, allFields, {
      itemTypeId: request.itemTypeId,
      filter: request.filter,
      sort: request.sort,
      search: request.search,
      incompleteOnly: request.incompleteOnly,
      includeVariants: request.includeVariants ?? true,
      limit: PAGE_SIZE,
      cursor,
    });

    for (const item of page.items) {
      const effective = (item.effectiveValues ?? {}) as Record<string, unknown>;
      rows.push([
        guardCsvCell(item.title),
        ...columns.map((field) => {
          const value = effective[field.key];
          if (value === null || value === undefined) return '';
          return guardCsvCell(formatValue(field.type, value, field.config));
        }),
      ]);
      if (rows.length >= MAX_EXPORT_ROWS) break;
    }
    if (rows.length >= MAX_EXPORT_ROWS || !page.nextCursor) break;
    cursor = page.nextCursor;
  }

  const csv = Papa.unparse({
    fields: ['Title', ...columns.map((f) => f.label)],
    data: rows,
  });

  const jobId = crypto.randomUUID();
  const storagePath = `exports/${workspaceId}/${jobId}/export.csv`;
  await putFile(storagePath, csv);

  const expiresAt = new Date(Date.now() + DOWNLOAD_TTL_SECONDS * 1000);
  const [job] = await tx
    .insert(exportJobs)
    .values({
      id: jobId,
      workspaceId,
      itemTypeId: request.itemTypeId,
      status: 'ready',
      format: 'csv',
      query: {
        filter: request.filter,
        sort: request.sort,
        search: request.search,
        visibleFieldKeys: columns.map((f) => f.key),
      },
      rowCount: rows.length,
      storagePath,
      expiresAt,
      createdBy: userId,
      completedAt: new Date(),
    })
    .returning();
  if (!job) throw new AppError('INTERNAL_ERROR', 'The export was not recorded.');

  return { job, downloadUrl: downloadUrlFor(job) };
}

export async function getExportJob(tx: Tx, workspaceId: string, id: string): Promise<ExportJob> {
  const [job] = await tx
    .select()
    .from(exportJobs)
    .where(and(eq(exportJobs.workspaceId, workspaceId), eq(exportJobs.id, id)))
    .limit(1);
  if (!job) throw new AppError('NOT_FOUND', 'That export no longer exists.');
  return job;
}

/** Signed like the spec's storage URLs — the token, not the session, is the auth. */
export function downloadUrlFor(job: ExportJob): string {
  if (!job.storagePath) throw new AppError('CONFLICT', 'This export has no file yet.');
  const token = signDownloadToken(job.storagePath, job.workspaceId, DOWNLOAD_TTL_SECONDS);
  return `/api/v1/exports/${job.id}/download?token=${token}`;
}
