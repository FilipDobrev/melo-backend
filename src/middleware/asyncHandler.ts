import type { RequestHandler } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';
import { requireAuth } from './auth';
import type { AuthorizedHandler, UnauthorizedHandler } from '../types/http';

/**
 * Express 4 does not forward rejected promises to the error middleware, and
 * its RequestHandler cannot describe the post-validate() request shape.
 * These two wrappers are the ONLY place that bridges the gap; controllers
 * never cast anything themselves.
 */

/**
 * Wraps a handler for a public route so a rejected promise reaches
 * `errorHandler` instead of hanging the request.
 *
 * The handler receives an `UnauthorizedRequest`, which has no `userId`, so a
 * handler needing one will not compile here - use {@link authed} for that.
 */
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

/**
 * Wraps a handler for a guarded route, returning `requireAuth` bundled
 * together with the handler: `router.post('/x', ...authed(controller.create))`.
 *
 * Bundling the two means the `AuthorizedRequest` type and the middleware that
 * actually satisfies it cannot drift apart. A handler typed as
 * `AuthorizedHandler` only compiles when passed through `authed()`, so
 * forgetting it is a COMPILE error - the handler simply won't be assignable.
 * Forgetting a bare `requireAuth` on an ad-hoc route, by contrast, is only a
 * runtime 500 the first time `req.userId` is read and turns out undefined.
 * That gap is the entire reason this helper exists.
 */
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
