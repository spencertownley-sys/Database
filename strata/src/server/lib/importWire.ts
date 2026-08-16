/**
 * Import job → wire shape. The status enum stores `validated`; the published
 * contract (API Design §8) calls that state `ready`, so the translation lives
 * here in exactly one place.
 */

import type { ImportJob } from '@/server/db/schema/imports';
import { signDownloadToken } from './storage';

const WIRE_STATUS: Record<ImportJob['status'], string> = {
  uploaded: 'uploaded',
  parsing: 'parsing',
  mapping: 'mapping',
  validating: 'validating',
  validated: 'ready',
  committing: 'committing',
  committed: 'committed',
  failed: 'failed',
  cancelled: 'cancelled',
};

export function shapeImportJob(job: ImportJob, workspaceId: string): Record<string, unknown> {
  return {
    id: job.id,
    status: WIRE_STATUS[job.status],
    itemTypeId: job.itemTypeId,
    profileId: job.profileId,
    fileName: job.fileName,
    rowCount: job.rowCount,
    mapping: job.mapping,
    matchKey: job.matchKey,
    options: job.options,
    detectedHeaders: job.detectedHeaders,
    previewRows: job.previewRows,
    validCount: job.rowCount - job.errorCount,
    errorCount: job.errorCount,
    warningCount: job.warningCount,
    willCreate: job.newCount,
    willUpdate: job.matchedCount,
    report: job.report,
    errorFileUrl: job.errorCsvPath
      ? `/api/v1/imports/${job.id}/errors.csv?token=${signDownloadToken(job.errorCsvPath, workspaceId)}`
      : null,
    changeSetId: job.changeSetId,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };
}
