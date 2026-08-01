export type AppErrorCode =
  | "validation_failed"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "invalid_state_transition"
  | "token_invalid"
  | "token_expired"
  | "provider_unavailable"
  | "provider_not_configured"
  | "consent_required"
  | "confirmation_required"
  | "confirmation_expired"
  | "rate_limited"
  | "upstream_failed";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly status: number;
  /** False for anything caused by bad input, auth or consent — never retry those. */
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(
    code: AppErrorCode,
    message: string,
    options: { status?: number; retryable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.status = options.status ?? defaultStatus(code);
    this.retryable = options.retryable ?? defaultRetryable(code);
    this.details = options.details;
  }
}

function defaultStatus(code: AppErrorCode): number {
  switch (code) {
    case "validation_failed":
      return 400;
    case "token_invalid":
    case "token_expired":
      return 401;
    case "forbidden":
    case "consent_required":
      return 403;
    case "not_found":
      return 404;
    case "conflict":
    case "invalid_state_transition":
    case "confirmation_required":
    case "confirmation_expired":
      return 409;
    case "rate_limited":
      return 429;
    case "provider_not_configured":
      return 501;
    case "provider_unavailable":
    case "upstream_failed":
      return 502;
  }
}

function defaultRetryable(code: AppErrorCode): boolean {
  return code === "provider_unavailable" || code === "upstream_failed" || code === "rate_limited";
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function toLoggable(error: unknown): Record<string, unknown> {
  if (isAppError(error)) {
    return { code: error.code, status: error.status, message: error.message, retryable: error.retryable };
  }
  if (error instanceof Error) return { message: error.message, name: error.name };
  return { message: String(error) };
}
