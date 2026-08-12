import type { RequestHandler } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import type { TypedHandler } from '../types/http';

/// Express 4 does not forward rejected promises to the error middleware, and
/// its RequestHandler cannot describe the post-`validate()` request shape.
///
/// This wrapper is the ONE place that bridges the two. Controllers are written
/// against TypedRequest/TypedResponse and never cast anything themselves.
export function asyncHandler<
  TBody = void,
  TQuery = unknown,
  TParams extends ParamsDictionary = ParamsDictionary,
  TResBody = unknown,
>(handler: TypedHandler<TBody, TQuery, TParams, TResBody>): RequestHandler {
  const wrapped: RequestHandler = (req, res, next) => {
    // Safe by construction: validate() has replaced body/query/params with the
    // parsed values before any handler runs.
    const typedReq = req as unknown as Parameters<typeof handler>[0];
    const typedRes = res as unknown as Parameters<typeof handler>[1];
    handler(typedReq, typedRes, next).catch(next);
  };
  return wrapped;
}
