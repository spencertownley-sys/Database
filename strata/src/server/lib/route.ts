/**
 * Route-handler plumbing.
 *
 * A handler does exactly four things: validate input with Zod, call `can()`,
 * call a service, shape the response. This module owns everything else —
 * context resolution, the error envelope, rate-limit headers, request ids — so
 * that no handler has a reason to grow a fifth responsibility.
 *
 * A route handler containing a SQL query or a business rule is a defect.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, toErrorResponse } from './errors';
import { resolveRequestContext, type RequestContext } from '@/server/auth/middleware';
import { rateLimitHeaders, type LimitKind } from './ratelimit';

export interface RouteOptions {
  limit?: LimitKind;
  /** Set for endpoints that must work without a workspace (auth, health). */
  anonymous?: boolean;
}

export type Handler<T> = (args: {
  request: Request;
  context: RequestContext;
  requestId: string;
}) => Promise<T>;

/**
 * The workspace a request addresses.
 *
 * `?workspace=` or `X-Strata-Workspace`, both carrying the slug. An API key is
 * already bound to one workspace and does not need it; a session-authenticated
 * call does, because a person may belong to several.
 */
function workspaceSlugOf(request: Request): string | undefined {
  const url = new URL(request.url);
  return (
    url.searchParams.get('workspace') ??
    request.headers.get('x-strata-workspace') ??
    undefined
  );
}

export function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
  });
}

export async function handle<T>(
  request: Request,
  handler: Handler<T>,
  options: RouteOptions = {},
): Promise<Response> {
  const requestId = randomUUID();

  try {
    const context = await resolveRequestContext(
      request,
      workspaceSlugOf(request),
      options.limit ?? 'read',
    );

    const result = await handler({ request, context, requestId });

    return jsonResponse(result, {
      headers: {
        'x-request-id': requestId,
        ...(context.rateLimit ? rateLimitHeaders(context.rateLimit) : {}),
      },
    });
  } catch (error) {
    if (!(error instanceof AppError)) {
      // The real error goes to the server log (and Sentry); the client gets a
      // generic envelope. A raw Postgres error leaks schema details and is
      // useless to the ops lead reading it.
      console.error(`[${requestId}]`, error);
    }
    const { status, body } = toErrorResponse(error, requestId);
    const headers: Record<string, string> = { 'x-request-id': requestId };
    if (error instanceof AppError && error.code === 'RATE_LIMITED') {
      const seconds = (error.details as { retryAfterSeconds?: number } | undefined)
        ?.retryAfterSeconds;
      if (seconds) headers['retry-after'] = String(seconds);
    }
    return jsonResponse(body, { status, headers });
  }
}

/** Parses and validates a JSON body, converting Zod issues into the envelope. */
export async function parseBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError('VALIDATION_FAILED', 'The request body is not valid JSON.');
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', 'Some fields are not valid.', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

export function parseQuery<S extends z.ZodTypeAny>(request: Request, schema: S): z.infer<S> {
  const url = new URL(request.url);
  const raw: Record<string, unknown> = {};
  for (const [key, value] of url.searchParams) {
    // Repeated keys become arrays, so `?id=a&id=b` works without a special case.
    const existing = raw[key];
    if (existing === undefined) raw[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else raw[key] = [existing, value];
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new AppError('VALIDATION_FAILED', 'Some query parameters are not valid.', {
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return result.data;
}

/** The idempotency key header, honoured on preview and commit. */
export function idempotencyKeyOf(request: Request): string | undefined {
  return request.headers.get('idempotency-key') ?? undefined;
}
