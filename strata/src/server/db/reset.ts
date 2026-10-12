/** Drops and recreates the public schema. Development only. */
import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

const url =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/strata';

if (process.env.NODE_ENV === 'production' && process.env.I_MEAN_IT !== 'yes') {
  console.error('Refusing to reset a production database.');
  process.exit(1);
}

const sqlClient = postgres(url, { max: 1, onnotice: () => {} });

try {
  await sqlClient.unsafe('DROP SCHEMA IF EXISTS public CASCADE');
  await sqlClient.unsafe('CREATE SCHEMA public');
  await sqlClient.unsafe('CREATE EXTENSION IF NOT EXISTS ltree');
  await sqlClient.unsafe('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await sqlClient.unsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  console.log('Schema reset.');
} finally {
  await sqlClient.end({ timeout: 5 });
}
