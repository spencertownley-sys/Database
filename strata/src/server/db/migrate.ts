/**
 * Migration runner.
 *
 * Extensions come first and outside the migration files: `items.path` is typed
 * `ltree` in the very first migration, so the type has to exist before drizzle
 * opens its transaction. Extensions are also the one piece of DDL that a
 * managed Postgres may pre-install, so creating them idempotently here keeps
 * the migration files portable between Supabase and a local container.
 */
import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/strata';

async function main(): Promise<void> {
  const sqlClient = postgres(url, { max: 1, onnotice: () => {} });

  try {
    await sqlClient.unsafe('CREATE EXTENSION IF NOT EXISTS ltree');
    await sqlClient.unsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    await sqlClient.unsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto');

    const db = drizzle(sqlClient);
    await migrate(db, { migrationsFolder: './drizzle/migrations' });

    // Local convenience only: give the non-owner RLS role a way to log in, so
    // `DATABASE_URL` can point at a connection that policies actually apply
    // to. Real environments provision this role out of band with a managed
    // secret — never a literal in a repo.
    if (process.env.CREATE_LOCAL_APP_ROLE === '1') {
      const password = process.env.LOCAL_APP_ROLE_PASSWORD ?? 'strata_app';
      await sqlClient.unsafe(`ALTER ROLE strata_app WITH LOGIN PASSWORD ${literal(password)}`);
      console.log('Granted LOGIN to strata_app (local development only).');
    }

    console.log('Migrations applied.');
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
}

/** Single-quoted SQL literal for the one place a bind parameter is illegal. */
function literal(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
