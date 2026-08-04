import type { ApiError } from '../types/axios';

/**
 * Extracts a single human-readable message for `field` from an API error's
 * body. DRF renders per-field validation errors as `{ field: string[] }`
 * (or, for a serializer-level `validate()` error raised against one field,
 * `{ field: string }`) — this normalises both shapes. Returns undefined if
 * the field has no error, so callers can use it directly as a conditional.
 */
export function fieldError(error: ApiError | null | undefined, field: string): string | undefined {
  const value = error?.body?.[field];
  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }
  if (typeof value === 'string') {
    return value;
  }
  return undefined;
}

/**
 * Extracts the top-level message for an object-level (rather than
 * per-field) API error — DRF renders a `validate()` error raised as a plain
 * string under `nonFieldErrors` (camelCased from `non_field_errors`), while
 * exception-style responses (auth failures, throttling) use `detail`.
 */
export function generalError(error: ApiError | null | undefined): string | undefined {
  return fieldError(error, 'nonFieldErrors') ?? error?.body?.detail;
}
