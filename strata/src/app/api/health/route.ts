import { sql } from 'drizzle-orm';
import { db } from '@/server/db';

/**
 * Uptime probe. Unauthenticated and with no tenant context by design — it must
 * answer before anyone is logged in, and it must never touch tenant data.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const startedAt = Date.now();
  try {
    await db.execute(sql`select 1`);
    return Response.json(
      { status: 'ok', database: 'ok', latencyMs: Date.now() - startedAt },
      { status: 200 },
    );
  } catch {
    // No error detail: this endpoint is public, and a connection string or
    // host name in a health response is an information disclosure.
    return Response.json(
      { status: 'degraded', database: 'unreachable', latencyMs: Date.now() - startedAt },
      { status: 503 },
    );
  }
}
