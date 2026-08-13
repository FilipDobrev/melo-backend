import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny } from 'zod';
import { type z as ZodType, ZodError } from 'zod';
import { ValidationError } from '../lib/errors';

export interface RequestSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/// Validated values are written back onto the request, so controllers read
/// parsed and typed data rather than raw strings.
export function validate(schemas: RequestSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params);
      if (schemas.query) req.query = schemas.query.parse(req.query);
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(new ValidationError('Request validation failed', formatZodIssues(error)));
        return;
      }
      next(error);
    }
  };
}

function formatZodIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

/// Helper for controllers that need the parsed type of a schema.
export type Infer<T extends ZodTypeAny> = ZodType.infer<T>;
