/**
 * The single error type crossing the service → route boundary.
 *
 * Services throw `AppError`. The route layer catches it and renders the
 * envelope in `toErrorResponse`. Nothing else is allowed to reach a client:
 * a raw Postgres error leaks table names, column names, and constraint
 * definitions, which is both an information disclosure and an unhelpful
 * message for the operations lead the product is built for.
 *
 * The code list and statuses are API Design §10, verbatim — the codes are a
 * published contract, not an internal vocabulary. Adding a code here without
 * adding it to the document (or vice versa) is a spec drift bug.
 */

import { toWire } from '@/lib/wire';

export const ERROR_CODES = {
  // --- 400 -------------------------------------------------------------------
  VALIDATION_ERROR: 400,
  /** Filter on a non-indexed field; `details.action` says how to fix it. */
  FIELD_NOT_FILTERABLE: 400,
  /** Session request missing the `X-Workspace-Id` header. */
  WORKSPACE_REQUIRED: 400,

  // --- 401 / 403 -------------------------------------------------------------
  UNAUTHORIZED: 401,
  /** Authenticated, not permitted; `details.required_role` when role-based. */
  FORBIDDEN: 403,
  /** Guests cannot use the API in v1 — this contains the field-permission gap. */
  GUEST_API_FORBIDDEN: 403,

  // --- 404 -------------------------------------------------------------------
  /** Absent, or outside the caller's workspace — deliberately indistinguishable. */
  NOT_FOUND: 404,

  // --- 409 -------------------------------------------------------------------
  CONFLICT: 409,
  /** Items changed since the preview; `details.conflicts`. Never auto-retried. */
  STALE_PREVIEW: 409,
  /** `If-Match` version mismatch. */
  STALE_WRITE: 409,
  HIERARCHY_CYCLE: 409,
  /** Delete needs `?cascade=true`. */
  HAS_CHILDREN: 409,
  /** Node delete needs an `on_members` disposition. */
  NODE_HAS_MEMBERS: 409,
  /** Item type delete needs `?confirm=<key>`. */
  TYPE_IN_USE: 409,
  /** Required field on an in-use type needs a default or an acknowledgment. */
  REQUIRES_ACKNOWLEDGMENT: 409,
  TREE_LIMIT_REACHED: 409,
  CONVERSION_REQUIRES_CONFIRMATION: 409,
  ALREADY_UNDONE: 409,

  // --- 410 -------------------------------------------------------------------
  PREVIEW_EXPIRED: 410,

  // --- 413 / 415 (imports, §8) ----------------------------------------------
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_FILE_TYPE: 415,
  UNDO_WINDOW_EXPIRED: 410,

  // --- 422 -------------------------------------------------------------------
  FILTER_TOO_COMPLEX: 422,
  TARGET_TOO_LARGE: 422,
  OPERATION_NOT_APPLICABLE: 422,
  /** Change set is not in `preview` status. */
  ALREADY_COMMITTED: 422,
  CANNOT_UNDO_SCHEMA_CHANGE: 422,
  /** Violates the v1 variant/hierarchy rules (PRD §4.6). */
  VARIANT_CONSTRAINT: 422,
  VARIANT_LIMIT_EXCEEDED: 422,
  NOT_VARIANT_ENABLED: 422,
  INVALID_VARIANT_AXIS: 422,
  /** Writing a `shared`-inheritance field on a variant (Tech Spec §2.5). */
  FIELD_READ_ONLY: 422,

  // --- 429 / 5xx -------------------------------------------------------------
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    /** Always an object, never an array — different codes populate different keys. */
    details?: Record<string, unknown>;
    request_id?: string;
  };
}

/**
 * `details` is contractually an object (API Design §10) so clients can read
 * the one key their code documents and ignore the rest. An array thrown by a
 * careless call site is wrapped rather than leaked.
 */
function asDetailsObject(details: unknown): Record<string, unknown> | undefined {
  if (details === undefined || details === null) return undefined;
  if (Array.isArray(details)) return { items: details };
  if (typeof details === 'object') return details as Record<string, unknown>;
  return { value: details };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = asDetailsObject(details);
    Error.captureStackTrace?.(this, AppError);
  }

  toEnvelope(requestId?: string): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        // Details keys are part of the wire contract (`details.field_key`,
        // `details.required_role`) and snake_case like everything else.
        ...(this.details !== undefined
          ? { details: toWire(this.details) as Record<string, unknown> }
          : {}),
        ...(requestId ? { request_id: requestId } : {}),
      },
    };
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Convenience constructors for the codes thrown from more than one service. */
export const errors = {
  notFound: (what: string, id?: string) =>
    new AppError('NOT_FOUND', id ? `${what} ${id} not found.` : `${what} not found.`),
  forbidden: (reason: string) => new AppError('FORBIDDEN', reason),
  validation: (message: string, details?: unknown) =>
    new AppError('VALIDATION_ERROR', message, details),
  internal: (message = 'Something went wrong on our end.') =>
    new AppError('INTERNAL_ERROR', message),
};

/**
 * Maps anything thrown inside a route handler onto the wire envelope.
 * Unknown throwables become a generic INTERNAL_ERROR — the real error goes to
 * the server log and Sentry, never to the response body.
 */
export function toErrorResponse(
  e: unknown,
  requestId?: string,
): { status: number; body: ErrorEnvelope } {
  if (isAppError(e)) {
    return { status: e.status, body: e.toEnvelope(requestId) };
  }
  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our end.',
        ...(requestId ? { request_id: requestId } : {}),
      },
    },
  };
}
