/**
 * Redis access, with a deliberate in-memory fallback.
 *
 * Redis backs three things here: rate limiting, idempotency keys, and cached
 * compiled schemas. None of them is a source of truth — losing all three
 * degrades the product, it does not corrupt it. So when Redis is unconfigured
 * (local development) or unreachable (a blip), every caller **fails open**.
 *
 * That choice is worth stating plainly because the opposite instinct is
 * strong: a limiter that takes the whole app down when its cache hiccups is a
 * far worse outcome than a few minutes of unmetered traffic at this scale.
 *
 * The in-memory fallback is per-process and therefore useless across serverless
 * instances. That is fine for what it protects and is never presented as more.
 */

import { Redis } from '@upstash/redis';

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;

export const redis: Redis | null =
  url && token ? new Redis({ url, token, automaticDeserialization: true }) : null;

export const isRedisConfigured = redis !== null;

interface MemoryEntry {
  value: unknown;
  expiresAt: number;
}

const memory = new Map<string, MemoryEntry>();

function sweep(): void {
  if (memory.size < 5_000) return;
  const now = Date.now();
  for (const [key, entry] of memory) {
    if (entry.expiresAt <= now) memory.delete(key);
  }
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (redis) {
    try {
      return (await redis.get<T>(key)) ?? null;
    } catch {
      return null;
    }
  }
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value as T;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  if (redis) {
    try {
      await redis.set(key, value, { ex: ttlSeconds });
    } catch {
      // Cache writes are advisory; a failure must not fail the request.
    }
    return;
  }
  sweep();
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function cacheDelete(prefixOrKey: string, isPrefix = false): Promise<void> {
  if (redis) {
    try {
      if (!isPrefix) {
        await redis.del(prefixOrKey);
        return;
      }
      // SCAN rather than KEYS: KEYS blocks the server, and a schema
      // invalidation must never stall every other tenant's requests.
      let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, { match: `${prefixOrKey}*`, count: 200 });
        cursor = String(next);
        if (keys.length) await redis.del(...keys);
      } while (cursor !== '0');
    } catch {
      // Stale cache is survivable; the TTL will clear it.
    }
    return;
  }
  if (!isPrefix) {
    memory.delete(prefixOrKey);
    return;
  }
  for (const key of memory.keys()) {
    if (key.startsWith(prefixOrKey)) memory.delete(key);
  }
}

/**
 * Claims an idempotency key.
 *
 * Returns `null` when the claim succeeded (this is the first time we have seen
 * the key) or the previously stored result when it did not. Callers replay the
 * stored result rather than performing the work twice — a retried bulk commit
 * must not apply twice, and a network timeout on a 500-row edit is exactly when
 * a client retries.
 */
export async function claimIdempotencyKey<T>(
  key: string,
  ttlSeconds = 86_400,
): Promise<{ claimed: true } | { claimed: false; result: T | null }> {
  const namespaced = `idem:${key}`;

  if (redis) {
    try {
      const set = await redis.set(namespaced, { pending: true }, { nx: true, ex: ttlSeconds });
      if (set === 'OK') return { claimed: true };
      const existing = await redis.get<{ pending?: boolean; result?: T }>(namespaced);
      return { claimed: false, result: existing?.result ?? null };
    } catch {
      // Redis down: allow the operation. The change-set table has a unique
      // index on (workspace_id, idempotency_key) as the durable backstop.
      return { claimed: true };
    }
  }

  sweep();
  const entry = memory.get(namespaced);
  if (entry && entry.expiresAt > Date.now()) {
    const stored = entry.value as { pending?: boolean; result?: T };
    return { claimed: false, result: stored.result ?? null };
  }
  memory.set(namespaced, { value: { pending: true }, expiresAt: Date.now() + ttlSeconds * 1000 });
  return { claimed: true };
}

export async function completeIdempotencyKey(
  key: string,
  result: unknown,
  ttlSeconds = 86_400,
): Promise<void> {
  await cacheSet(`idem:${key}`, { result }, ttlSeconds);
}

export async function releaseIdempotencyKey(key: string): Promise<void> {
  await cacheDelete(`idem:${key}`);
}

/** Test seam: clears the in-memory fallback between cases. */
export function __clearMemoryCache(): void {
  memory.clear();
}
