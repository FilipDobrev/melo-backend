import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

/** Terminal handler mounted after all routes: no route matched, so 404. */
export function notFoundHandler(_req: Request, res: Response): void {
  const body: ErrorBody = { error: { code: 'NOT_FOUND', message: 'Route not found' } };
  res.status(404).json(body);
}

/**
 * Express's global error handler (4-arg signature required by Express to be
 * recognized as one). Maps a thrown/rejected error to a status and JSON body
 * via {@link mapError}; 5xx responses get a `requestId` (pino-http's request
 * id) so a user can hand it to support, and are logged with full error
 * detail, while every other status is only debug-logged. Internal error
 * detail is never included in the response body itself.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const mapped = mapError(err);

  const body: ErrorBody = { error: { code: mapped.code, message: mapped.message } };
  if (mapped.details !== undefined) body.error.details = mapped.details;

  if (mapped.status >= 500) {
    // 4xx is the caller's own fault - no correlation id needed. 5xx is where
    // a user needs something to hand support, and it must be the exact id
    // pino-http put on this request's log line.
    body.error.requestId = String(req.id);
    logger.error({ err, path: req.path, method: req.method }, 'Unhandled request error');
  } else {
    logger.debug({ code: mapped.code, path: req.path }, 'Request rejected');
  }

  res.status(mapped.status).json(body);
}

/**
 * Maps an error to a response shape. `AppError` subclasses pass their own
 * status/code through unchanged. Known Prisma error codes are translated so
 * a raw database constraint failure reads as an API error instead of a 500:
 * P2002 (unique constraint) -> 409 CONFLICT, P2025 (record not found) -> 404
 * NOT_FOUND, P2003 (foreign key constraint) -> 400 BAD_REQUEST. Everything
 * else - including unmapped Prisma codes - falls through to a generic 500;
 * the real error is logged by the caller, never returned to the client.
 */
function mapError(err: unknown): {
  status: number;
  code: string;
  message: string;
  details?: unknown;
} {
  if (err instanceof AppError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details };
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return { status: 409, code: 'CONFLICT', message: 'Resource already exists' };
    }
    if (err.code === 'P2025') {
      return { status: 404, code: 'NOT_FOUND', message: 'Resource not found' };
    }
    if (err.code === 'P2003') {
      return { status: 400, code: 'BAD_REQUEST', message: 'Referenced resource does not exist' };
    }
  }

  // Internal details are logged, never returned to the client.
  return { status: 500, code: 'INTERNAL', message: 'Internal server error' };
}
