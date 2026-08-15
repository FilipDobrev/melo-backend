/** Stable machine-readable codes returned in `error.code` of every error response. */
export type ErrorCode =
  | 'BAD_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'VALIDATION_FAILED'
  | 'INTERNAL';

/** Base class for intentional, client-facing errors. Caught by `errorHandler`. */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** 400 - malformed or semantically invalid request. */
export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: unknown) {
    super(400, 'BAD_REQUEST', message, details);
  }
}

/** 401 - missing, malformed, or invalid/expired credentials. */
export class UnauthenticatedError extends AppError {
  constructor(message = 'Authentication required') {
    super(401, 'UNAUTHENTICATED', message);
  }
}

/** 403 - authenticated, but not allowed to act on this resource. */
export class ForbiddenError extends AppError {
  constructor(message = 'You do not have access to this resource') {
    super(403, 'FORBIDDEN', message);
  }
}

/** 404 - resource does not exist (or is hidden from this caller). */
export class NotFoundError extends AppError {
  constructor(message = 'Resource not found') {
    super(404, 'NOT_FOUND', message);
  }
}

/** 409 - request conflicts with existing state, e.g. a unique constraint. */
export class ConflictError extends AppError {
  constructor(message = 'Resource already exists') {
    super(409, 'CONFLICT', message);
  }
}

/** 422 - input failed schema validation. `details` carries the per-field issues. */
export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super(422, 'VALIDATION_FAILED', message, details);
  }
}
