import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { schema } from './schema';
import { AppError } from '../lib/errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/strata';

/**
 * Transaction-mode pooling (PgBouncer) cannot support server-side prepared
 * statements, because the statement is prepared on one backend and executed on
 * another. `prepare: false` is required, not an optimisation choice.
 */
const client = postgres(connectionString, {
  prepare: false,
  max: Number(process.env.PG_POOL_MAX ?? 10),
  idle_timeout: 20,
  connect_timeout: 10,
  onnotice: () => {},
});

export const db = drizzle(client, { schema, logger: process.env.DRIZZLE_LOG === '1' });

export type Db = typeof db;
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The only sanctioned way to touch tenant data.
 *
 * Opens a transaction, pins the workspace for its duration, and hands the
 * transaction handle to `fn`. Every RLS policy compares `workspace_id`
 * against `current_setting('app.workspace_id')`, so a query that forgets its
 * own `WHERE workspace_id = …` still cannot see another tenant's rows.
 *
 * Two details are load-bearing:
 *
 *  1. **`set_config(..., true)` is `SET LOCAL`.** The third argument means
 *     transaction-scoped. A plain `SET` (or `set_config(..., false)`) survives
 *     on the pooled connection after the transaction ends and hands this
 *     tenant's context to whoever picks the connection up next. That is a
 *     cross-tenant data leak, and it is invisible under single-tenant testing
 *     — which is why `tests/integration/tenantIsolation.test.ts` exists.
 *
 *  2. **`SET LOCAL` cannot take a bind parameter**, so the id has to arrive
 *     via `set_config`, whose value argument *can* be bound. Interpolating the
 *     id into a `SET LOCAL` string would be the one injection point in the
 *     codebase that RLS itself depends on; `assertWorkspaceId` closes the door
 *     a second time.
 */
export async function withWorkspace<T>(
  workspaceId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  assertWorkspaceId(workspaceId);
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
    return fn(tx);
  });
}

/**
 * Runs inside an existing transaction when the caller already owns one.
 * Re-pins the workspace so a nested service cannot inherit the wrong context.
 */
export async function pinWorkspace(tx: Tx, workspaceId: string): Promise<void> {
  assertWorkspaceId(workspaceId);
  await tx.execute(sql`select set_config('app.workspace_id', ${workspaceId}, true)`);
}

/**
 * For the handful of operations that legitimately precede workspace context:
 * resolving a slug, authenticating a session, accepting an invite, creating
 * the first workspace. Named to be conspicuous in review — if this appears in
 * a service under `services/`, that is a bug, not an exception.
 */
export async function withoutWorkspace<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => fn(tx));
}

function assertWorkspaceId(workspaceId: string): void {
  if (!UUID_RE.test(workspaceId)) {
    throw new AppError('INTERNAL', 'withWorkspace() requires a uuid workspace id.');
  }
}

/** Used by tests and the graceful-shutdown path. */
export async function closeDb(): Promise<void> {
  await client.end({ timeout: 5 });
}

export { client as pgClient };
export { schema };
