import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';

interface ErrorBody {
  error: { code: string; message: string; details?: unknown };
}

export function notFoundHandler(_req: Request, res: Response): void {
  const body: ErrorBody = { error: { code: 'NOT_FOUND', message: 'Route not found' } };
  res.status(404).json(body);
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const mapped = mapError(err);

  if (mapped.status >= 500) {
    logger.error({ err, path: req.path, method: req.method }, 'Unhandled request error');
  } else {
    logger.debug({ code: mapped.code, path: req.path }, 'Request rejected');
  }

  const body: ErrorBody = { error: { code: mapped.code, message: mapped.message } };
  if (mapped.details !== undefined) body.error.details = mapped.details;
  res.status(mapped.status).json(body);
}

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
