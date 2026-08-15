/**
 * API key minting and verification.
 *
 * Keys are stored as `SHA-256(pepper || secret)`. The pepper lives in the
 * environment rather than the database, so a dump of the `api_keys` table
 * alone cannot be brute-forced offline — which matters because the secret is
 * high-entropy but the hash is fast by design (a login-grade KDF on every API
 * request would dominate response time).
 *
 * The plaintext is shown exactly once. `prefix` is stored in the clear so the
 * settings screen can name a key without being able to authenticate as it.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, or, gt, sql } from 'drizzle-orm';
import type { Tx } from '@/server/db';
import { apiKeys, type ApiKeyScope } from '@/server/db/schema/apiKeys';
import { workspaceMembers, type MemberRole } from '@/server/db/schema/workspaces';
import { AppError } from '@/server/lib/errors';

const KEY_PREFIX = 'sk_strata_';
const PREFIX_DISPLAY_LENGTH = KEY_PREFIX.length + 6;

function pepper(): string {
  const value = process.env.API_KEY_PEPPER;
  if (!value) {
    // Without a pepper the stored hashes are unsalted SHA-256 of a known
    // format — refuse rather than silently weaken every key in the system.
    throw new AppError('INTERNAL', 'API_KEY_PEPPER is not configured.');
  }
  return value;
}

export function hashApiKey(secret: string): string {
  return createHash('sha256').update(`${pepper()}${secret}`, 'utf8').digest('hex');
}

export function generateApiKey(): { secret: string; hashed: string; prefix: string } {
  const secret = `${KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
  return {
    secret,
    hashed: hashApiKey(secret),
    prefix: secret.slice(0, PREFIX_DISPLAY_LENGTH),
  };
}

export function looksLikeApiKey(value: string): boolean {
  return value.startsWith(KEY_PREFIX);
}

export interface ApiKeyIdentity {
  apiKeyId: string;
  workspaceId: string;
  memberId: string;
  userId: string | null;
  role: MemberRole;
  scopes: ApiKeyScope[];
}

/**
 * Resolves a presented key.
 *
 * Note the **guest rejection**: a key whose member is a guest is refused at
 * authentication, before any permission check. Guests have a field subset that
 * only the renderer enforces, and the API has no such subsetting — so rather
 * than ship an API that silently ignores the restriction, v1 denies guests the
 * API entirely. That is what contains the field-permission gap until
 * field-level permissions land.
 */
export async function resolveApiKey(tx: Tx, presented: string): Promise<ApiKeyIdentity> {
  const hashed = hashApiKey(presented);

  const rows = await tx
    .select({
      id: apiKeys.id,
      workspaceId: apiKeys.workspaceId,
      memberId: apiKeys.memberId,
      hashedKey: apiKeys.hashedKey,
      scopes: apiKeys.scopes,
      role: workspaceMembers.role,
      userId: workspaceMembers.userId,
      memberStatus: workspaceMembers.status,
    })
    .from(apiKeys)
    .innerJoin(workspaceMembers, eq(workspaceMembers.id, apiKeys.memberId))
    .where(
      and(
        eq(apiKeys.hashedKey, hashed),
        isNull(apiKeys.revokedAt),
        or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, sql`now()`)),
      ),
    )
    .limit(1);

  const row = rows[0];
  if (!row) throw new AppError('UNAUTHENTICATED', 'That API key is not valid.');

  // Constant-time compare even though the lookup already matched: the row was
  // found by an indexed equality, and this closes the timing channel that
  // would otherwise distinguish "no such key" from "wrong key".
  const presentedBuffer = Buffer.from(hashed, 'hex');
  const storedBuffer = Buffer.from(row.hashedKey, 'hex');
  if (
    presentedBuffer.length !== storedBuffer.length ||
    !timingSafeEqual(presentedBuffer, storedBuffer)
  ) {
    throw new AppError('UNAUTHENTICATED', 'That API key is not valid.');
  }

  if (row.memberStatus !== 'active') {
    throw new AppError('UNAUTHENTICATED', 'The account behind this key is no longer active.');
  }

  if (row.role === 'guest') {
    throw new AppError(
      'GUEST_API_DENIED',
      'Guest accounts cannot use the API. Guest access is limited to the app, where their field restrictions are applied.',
    );
  }

  await tx.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, row.id));

  return {
    apiKeyId: row.id,
    workspaceId: row.workspaceId,
    memberId: row.memberId,
    userId: row.userId,
    role: row.role,
    scopes: row.scopes as ApiKeyScope[],
  };
}
