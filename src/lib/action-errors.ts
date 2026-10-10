export type ActionResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };

/** Thrown deliberately with a message that's safe to show the user. */
export class ValidationError extends Error {}
