/**
 * Startup diagnosis.
 *
 * A Server Component that throws on a failed database connection surfaces in
 * the browser as `AggregateError: An error occurred in the Server Components
 * render but no message was provided` — Next masks Server Component errors on
 * purpose, so the actual `ECONNREFUSED` only appears in the terminal. That is
 * correct behaviour for production and useless the first time someone runs the
 * project.
 *
 * So rather than letting the connection failure propagate, the shell asks this
 * module what is wrong and renders the answer. Each diagnosis maps to the exact
 * command that fixes it, because "check your database" is not help.
 */

import { sql } from 'drizzle-orm';
import { db } from './index';

export type ReadinessState =
  | 'ready'
  | 'unreachable'
  | 'auth_failed'
  | 'missing_database'
  | 'not_migrated'
  | 'not_seeded'
  | 'unknown';

export interface Readiness {
  state: ReadinessState;
  title: string;
  detail: string;
  /** Shell commands, in the order they should be run. */
  fix: string[];
  /** The underlying driver message, shown only outside production. */
  raw?: string;
}

function pgCode(error: unknown): string | null {
  let cursor: unknown = error;
  for (let depth = 0; cursor && depth < 6; depth += 1) {
    const code = (cursor as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    // AggregateError wraps the per-address attempts; they all share a cause.
    const errors = (cursor as { errors?: unknown }).errors;
    if (Array.isArray(errors) && errors.length > 0) {
      cursor = errors[0];
      continue;
    }
    cursor = (cursor as { cause?: unknown }).cause;
  }
  return null;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) {
    const errors = (error as { errors?: unknown }).errors;
    if (Array.isArray(errors) && errors[0] instanceof Error) {
      return (errors[0] as Error).message;
    }
    return error.message;
  }
  return String(error);
}

const hostHint = (): string => {
  const url = process.env.DATABASE_URL ?? '(DATABASE_URL is not set)';
  // Never print the password back at the user, even locally.
  return url.replace(/:\/\/([^:]+):[^@]*@/, '://$1:***@');
};

export async function checkDatabaseReadiness(): Promise<Readiness> {
  try {
    const result = await db.execute(sql`select count(*)::int as n from workspaces`);
    const count = Number(([...result][0] as { n: number } | undefined)?.n ?? 0);

    if (count === 0) {
      return {
        state: 'not_seeded',
        title: 'The database is empty.',
        detail:
          'Migrations have run, but there is no workspace to open yet. The seed creates two ' +
          'workspaces with sample items so there is something to look at.',
        fix: ['npm run db:seed'],
      };
    }

    return { state: 'ready', title: '', detail: '', fix: [] };
  } catch (error) {
    const code = pgCode(error);
    const raw = messageOf(error);

    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') {
      return {
        state: 'unreachable',
        title: 'Postgres is not reachable.',
        detail:
          `Nothing is listening at ${hostHint()}. Most often the container is not running yet — ` +
          'and note that `docker compose up -d` exits successfully even when Docker itself is not started.',
        fix: ['docker compose up -d', 'docker compose ps', 'CREATE_LOCAL_APP_ROLE=1 npm run db:migrate', 'npm run db:seed'],
        raw,
      };
    }

    if (code === '28P01' || code === '28000') {
      return {
        state: 'auth_failed',
        title: 'Postgres refused the login.',
        detail:
          'The app connects as `strata_app`, a deliberately unprivileged role — row-level security ' +
          'is bypassed by table owners, so connecting as the owner would make every policy ' +
          'decorative. That role only gets a password when the migration is run with ' +
          '`CREATE_LOCAL_APP_ROLE=1`, which is easy to miss.',
        fix: ['CREATE_LOCAL_APP_ROLE=1 npm run db:migrate', 'npm run db:seed'],
        raw,
      };
    }

    if (code === '3D000') {
      return {
        state: 'missing_database',
        title: 'That database does not exist.',
        detail: `Postgres is running but has no database matching ${hostHint()}.`,
        fix: ['docker compose down -v', 'docker compose up -d', 'CREATE_LOCAL_APP_ROLE=1 npm run db:migrate', 'npm run db:seed'],
        raw,
      };
    }

    if (code === '42P01') {
      return {
        state: 'not_migrated',
        title: 'The tables have not been created yet.',
        detail: 'Postgres is reachable, but no migration has run against this database.',
        fix: ['CREATE_LOCAL_APP_ROLE=1 npm run db:migrate', 'npm run db:seed'],
        raw,
      };
    }

    return {
      state: 'unknown',
      title: 'The database could not be queried.',
      detail: 'The connection was made but the check failed. The terminal running `npm run dev` has the full error.',
      fix: ['docker compose ps', 'CREATE_LOCAL_APP_ROLE=1 npm run db:migrate'],
      raw,
    };
  }
}
