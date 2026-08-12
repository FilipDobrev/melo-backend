import type { RequestHandler } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import { requireAuth } from './auth';
import type { AuthorizedHandler, UnauthorizedHandler } from '../types/http';

/// Express 4 does not forward rejected promises to the error middleware, and
/// its RequestHandler cannot describe the post-validate() request shape.
/// These two wrappers are the ONLY place that bridges the gap; controllers
/// never cast anything themselves.

/// Public route. The handler receives an UnauthorizedRequest, which has no
/// userId, so a handler needing one will not compile here.
export function asyncHandler<
  TBody = void,
  TQuery = unknown,
  TParams extends ParamsDictionary = ParamsDictionary,
  TResBody = unknown,
>(handler: UnauthorizedHandler<TBody, TQuery, TParams, TResBody>): RequestHandler {
  return (req, res, next) => {
    // Safe by construction: validate() has replaced body/query/params before
    // any handler runs.
    const typedReq = req as unknown as Parameters<typeof handler>[0];
    const typedRes = res as unknown as Parameters<typeof handler>[1];
    handler(typedReq, typedRes, next).catch(next);
  };
}

/// Guarded route. Returns requireAuth bundled with the handler, so the
/// AuthorizedRequest type and the middleware that satisfies it cannot drift
/// apart: `router.post('/x', ...authed(controller.create))`.
export function authed<
  TBody = void,
  TQuery = unknown,
  TParams extends ParamsDictionary = ParamsDictionary,
  TResBody = unknown,
>(handler: AuthorizedHandler<TBody, TQuery, TParams, TResBody>): [RequestHandler, RequestHandler] {
  const wrapped: RequestHandler = (req, res, next) => {
    // requireAuth ran immediately before this and rejects when userId is
    // absent, so the cast to a userId-bearing request holds.
    const typedReq = req as unknown as Parameters<typeof handler>[0];
    const typedRes = res as unknown as Parameters<typeof handler>[1];
    handler(typedReq, typedRes, next).catch(next);
  };
  return [requireAuth, wrapped];
}
