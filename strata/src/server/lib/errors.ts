/**
 * The single error type crossing the service → route boundary.
 *
 * Services throw `AppError`. The route layer catches it and renders the
 * envelope in `toErrorResponse`. Nothing else is allowed to reach a client:
 * a raw Postgres error leaks table names, column names, and constraint
 * definitions, which is both an information disclosure and an unhelpful
 * message for the operations lead the product is built for.
 */

export const ERROR_CODES = {
  // --- auth / tenancy -------------------------------------------------------
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  GUEST_API_DENIED: 403,
  WORKSPACE_NOT_FOUND: 404,
  NOT_A_MEMBER: 403,
  OUT_OF_SCOPE: 403,

  // --- generic --------------------------------------------------------------
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
  NOT_IMPLEMENTED: 501,

  // --- change sets ----------------------------------------------------------
  STALE_PREVIEW: 409,
  CHANGE_SET_ALREADY_COMMITTED: 409,
  CHANGE_SET_NOT_PREVIEW: 409,
  CHANGE_SET_ALREADY_UNDONE: 409,
  CHANGE_SET_NOT_UNDOABLE: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  BULK_LIMIT_EXCEEDED: 422,

  // --- hierarchy / trees ----------------------------------------------------
  HIERARCHY_CYCLE: 422,
  HIERARCHY_DEPTH_EXCEEDED: 422,
  TREE_NODE_HAS_ITEMS: 409,
  TREE_LIMIT_EXCEEDED: 422,

  // --- item types / fields --------------------------------------------------
  FIELD_KEY_IMMUTABLE: 422,
  FIELD_KEY_TAKEN: 409,
  FIELD_TYPE_CHANGE_UNSAFE: 422,
  REQUIRED_FIELD_NEEDS_ACKNOWLEDGEMENT: 422,
  ITEM_TYPE_IN_USE: 409,

  // --- variants -------------------------------------------------------------
  /** Writing a `shared`-inheritance field on a variant (Tech Spec §2.5). */
  FIELD_READ_ONLY: 422,
  VARIANT_LIMIT_EXCEEDED: 422,
  VARIANT_CANNOT_HAVE_CHILDREN: 422,
  VARIANT_MODEL_CANNOT_BE_NESTED: 422,
  VARIANT_AXIS_INVALID: 422,
  VARIANT_PROPAGATION_IN_PROGRESS: 409,

  // --- import / export ------------------------------------------------------
  IMPORT_FILE_TOO_LARGE: 422,
  IMPORT_FILE_TYPE_UNSUPPORTED: 422,
  IMPORT_ROW_LIMIT_EXCEEDED: 422,
  IMPORT_MAPPING_INVALID: 422,
  EXPORT_TOO_LARGE_FOR_SYNC: 422,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = details;
    Error.captureStackTrace?.(this, AppError);
  }

  toEnvelope(requestId?: string): ErrorEnvelope {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined ? { details: this.details } : {}),
        ...(requestId ? { requestId } : {}),
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
    new AppError('VALIDATION_FAILED', message, details),
  internal: (message = 'Something went wrong on our end.') => new AppError('INTERNAL', message),
};

/**
 * Maps anything thrown inside a route handler onto the wire envelope.
 * Unknown throwables become a generic INTERNAL — the real error goes to the
 * server log and Sentry, never to the response body.
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
        code: 'INTERNAL',
        message: 'Something went wrong on our end.',
        ...(requestId ? { requestId } : {}),
      },
    },
  };
}
