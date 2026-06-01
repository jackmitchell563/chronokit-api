/**
 * Structured error handling.
 *
 * Every error surfaced to a caller is an {@link ApiError} carrying an HTTP status,
 * a stable machine-readable `code`, and a human message. The global error handler
 * serializes these into a consistent JSON envelope so consumers can branch on `code`
 * without string-matching messages.
 */

export type ErrorCode =
  | "validation_error"
  | "invalid_rrule"
  | "invalid_cron"
  | "invalid_timezone"
  | "invalid_date"
  | "unbounded_rule"
  | "unauthorized"
  | "not_found"
  | "internal_error"

export interface ApiErrorBody {
  error: {
    code: ErrorCode
    message: string
    /** Optional structured detail (e.g. zod field issues), safe to expose. */
    details?: unknown
  }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: ErrorCode
  readonly details?: unknown

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.details = details
  }

  toBody(): ApiErrorBody {
    const error: ApiErrorBody["error"] = { code: this.code, message: this.message }
    if (this.details !== undefined) error.details = this.details
    return { error }
  }

  // --- Convenience constructors for the common 4xx cases ---

  static badRequest(code: ErrorCode, message: string, details?: unknown): ApiError {
    return new ApiError(400, code, message, details)
  }

  static unauthorized(message = "Missing or invalid RapidAPI proxy secret."): ApiError {
    return new ApiError(401, "unauthorized", message)
  }

  static notFound(message = "Resource not found."): ApiError {
    return new ApiError(404, "not_found", message)
  }
}
