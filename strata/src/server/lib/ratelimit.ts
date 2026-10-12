/**
 * Request rate limiting.
 *
 * **Fails open.** If Redis is unreachable the request is allowed. A limiter
 * that takes the product down when its cache blips is a worse outcome than
 * brief unmetered traffic at this scale, and the failure mode of the opposite
 * choice — every tenant locked out because one cache node restarted — is the
 * kind of incident that ends trials.
 */

import { Ratelimit } from '@upstash/ratelimit';
import { redis } from './redis';

export type LimitKind = 'read' | 'write' | 'bulk' | 'auth' | 'import';

const WINDOWS: Record<LimitKind, { tokens: number; window: `${number} ${'s' | 'm' | 'h'}` }> = {
  read: { tokens: 600, window: '1 m' },
  write: { tokens: 180, window: '1 m' },
  // Bulk operations are expensive and rarely repeated in quick succession by
  // a human; a low ceiling here is the main protection against a runaway
  // script rewriting a whole workspace.
  bulk: { tokens: 20, window: '1 m' },
  auth: { tokens: 10, window: '1 m' },
  import: { tokens: 10, window: '1 h' },
};

const limiters = new Map<LimitKind, Ratelimit>();

function limiterFor(kind: LimitKind): Ratelimit | null {
  if (!redis) return null;
  const existing = limiters.get(kind);
  if (existing) return existing;
  const config = WINDOWS[kind];
  const limiter = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(config.tokens, config.window),
    prefix: `rl:${kind}`,
    analytics: false,
  });
  limiters.set(kind, limiter);
  return limiter;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export async function checkRateLimit(
  kind: LimitKind,
  identifier: string,
): Promise<RateLimitResult> {
  const limiter = limiterFor(kind);
  const config = WINDOWS[kind];

  if (!limiter) {
    return { allowed: true, limit: config.tokens, remaining: config.tokens, resetAt: Date.now() };
  }

  try {
    const result = await limiter.limit(identifier);
    return {
      allowed: result.success,
      limit: result.limit,
      remaining: result.remaining,
      resetAt: result.reset,
    };
  } catch {
    return { allowed: true, limit: config.tokens, remaining: config.tokens, resetAt: Date.now() };
  }
}

export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(Math.max(result.remaining, 0)),
    'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
  };
}
