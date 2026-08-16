/**
 * File storage for uploads and generated exports.
 *
 * The Tech Spec targets Supabase Storage; this build stores files on local
 * disk behind the same narrow interface (`put`/`get`/`remove`), so swapping
 * the backend touches this file only. Paths are always workspace-prefixed and
 * validated against traversal — a stored path is data, never trusted.
 *
 * Downloads work like signed URLs: `signDownloadToken` mints a short-lived
 * HMAC token binding {path, workspace, expiry}, and the download routes verify
 * it instead of requiring auth headers a browser download cannot send.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from './errors';

const STORAGE_ROOT = process.env.STRATA_STORAGE_DIR ?? '.data/files';

function secret(): string {
  return process.env.API_KEY_PEPPER ?? 'dev-only-pepper-change-me';
}

/** Rejects anything that could escape the storage root. */
function resolveSafe(storagePath: string): string {
  if (storagePath.includes('..') || path.isAbsolute(storagePath)) {
    throw new AppError('VALIDATION_ERROR', 'Invalid storage path.');
  }
  return path.join(STORAGE_ROOT, storagePath);
}

export async function putFile(storagePath: string, content: Buffer | string): Promise<void> {
  const full = resolveSafe(storagePath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content);
}

export async function getFile(storagePath: string): Promise<Buffer> {
  try {
    return await readFile(resolveSafe(storagePath));
  } catch {
    throw new AppError('NOT_FOUND', 'That file no longer exists.');
  }
}

export async function removeFile(storagePath: string): Promise<void> {
  await rm(resolveSafe(storagePath), { force: true });
}

// ---------------------------------------------------------------------------
// download tokens
// ---------------------------------------------------------------------------

function hmac(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** One-hour default, matching the API Design §8 signed-URL lifetime. */
export function signDownloadToken(
  storagePath: string,
  workspaceId: string,
  ttlSeconds = 3600,
): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = Buffer.from(JSON.stringify({ p: storagePath, w: workspaceId, e: exp })).toString(
    'base64url',
  );
  return `${payload}.${hmac(payload)}`;
}

export interface DownloadClaim {
  storagePath: string;
  workspaceId: string;
}

export function verifyDownloadToken(token: string): DownloadClaim {
  const dot = token.lastIndexOf('.');
  if (dot < 1) throw new AppError('UNAUTHORIZED', 'This download link is not valid.');
  const payload = token.slice(0, dot);
  const signature = token.slice(dot + 1);

  const expected = hmac(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new AppError('UNAUTHORIZED', 'This download link is not valid.');
  }

  let claim: { p?: string; w?: string; e?: number };
  try {
    claim = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as typeof claim;
  } catch {
    throw new AppError('UNAUTHORIZED', 'This download link is not valid.');
  }
  if (!claim.p || !claim.w || typeof claim.e !== 'number') {
    throw new AppError('UNAUTHORIZED', 'This download link is not valid.');
  }
  if (claim.e * 1000 < Date.now()) {
    throw new AppError('UNAUTHORIZED', 'This download link has expired. Request the export again.');
  }
  return { storagePath: claim.p, workspaceId: claim.w };
}
