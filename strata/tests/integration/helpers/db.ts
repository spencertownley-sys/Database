/**
 * Integration-test database access.
 *
 * Tests connect through the **same non-owner role the application uses**. That
 * detail is the entire value of the tenant isolation suite: superusers and
 * table owners bypass row-level security unconditionally, so a test that
 * connects as `postgres` would pass against a database with no policies at all.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { schema } from '@/server/db/schema';

const appUrl =
  process.env.DATABASE_URL ?? 'postgresql://strata_app:strata_app@localhost:5432/strata';
const ownerUrl =
  process.env.DIRECT_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/strata';

/** Connects as `strata_app` — RLS applies. This is what the app uses. */
export const appClient = postgres(appUrl, { prepare: false, max: 4, onnotice: () => {} });
export const appDb = drizzle(appClient, { schema });

/** Connects as the owner — RLS is bypassed. Fixtures and assertions only. */
export const ownerClient = postgres(ownerUrl, { max: 2, onnotice: () => {} });
export const ownerDb = drizzle(ownerClient, { schema });

export type AppTx = Parameters<Parameters<typeof appDb.transaction>[0]>[0];

/** Mirrors `withWorkspace()` against the test connection. */
export async function asWorkspace<T>(
  workspaceId: string,
  fn: (tx: AppTx) => Promise<T>,
): Promise<T> {
  return appDb.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
    return fn(tx);
  });
}

/** A transaction with *no* workspace pinned, to prove the fail-closed default. */
export async function withNoWorkspace<T>(fn: (tx: AppTx) => Promise<T>): Promise<T> {
  return appDb.transaction(async (tx) => fn(tx));
}

export async function workspaceIdBySlug(slug: string): Promise<string> {
  const rows = await ownerClient<Array<{ id: string }>>`
    select id from workspaces where slug = ${slug} limit 1
  `;
  const id = rows[0]?.id;
  if (!id) throw new Error(`Seed missing: no workspace with slug "${slug}". Run \`npm run db:seed\`.`);
  return id;
}

export async function closeTestDb(): Promise<void> {
  await Promise.all([appClient.end({ timeout: 5 }), ownerClient.end({ timeout: 5 })]);
}
