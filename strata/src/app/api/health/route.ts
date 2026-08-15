import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { isRedisConfigured, redis } from '@/server/lib/redis';

/**
 * Uptime probe — API Design §1.0. Unauthenticated and with no tenant context
 * by design: it must answer before anyone is logged in, and it must never
 * touch tenant data. Returns `{ status, db, redis, version }`; a failing
 * dependency is named, with no further detail — a connection string or host
 * name in a public health response is an information disclosure.
 */
export const dynamic = 'force-dynamic';

const VERSION = process.env.npm_package_version ?? '0.1.0';

export async function GET(): Promise<Response> {
  const [dbOk, redisOk] = await Promise.all([checkDb(), checkRedis()]);

  const healthy = dbOk && redisOk;
  return Response.json(
    {
      status: healthy ? 'ok' : 'degraded',
      db: dbOk ? 'ok' : 'unreachable',
      // Redis is optional in development; absent is not degraded, down is.
      redis: redisOk ? (isRedisConfigured ? 'ok' : 'not_configured') : 'unreachable',
      version: VERSION,
    },
    { status: healthy ? 200 : 503 },
  );
}

async function checkDb(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

async function checkRedis(): Promise<boolean> {
  if (!redis) return true;
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}
