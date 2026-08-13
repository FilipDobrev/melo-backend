import type { NextFunction, Request, Response } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';

export interface ErrorResponse {
  error: { code: string; message: string; details?: unknown };
}

/// Body, query and params carry the types that `validate()` actually wrote.
///
/// `query` is replaced rather than narrowed, because Express types it as
/// ParsedQs (string | string[] only), which cannot express the numbers and
/// arrays that zod coercion produces. Constraining to ParsedQs instead would
/// mean `?limit=20` types as string while holding a number at runtime.
type BaseRequest<TBody, TQuery, TParams extends ParamsDictionary> = Omit<
  Request<TParams, unknown, TBody>,
  'query'
> & {
  query: TQuery;
};

/// A request on a public route. There is no authenticated user.
export type UnauthorizedRequest<
  TBody = void,
  TQuery = unknown,
  TParams extends ParamsDictionary = ParamsDictionary,
> = BaseRequest<TBody, TQuery, TParams>;

/// A request on a guarded route. `userId` is guaranteed present.
///
/// Only reachable through `authed()` in middleware/authed.ts, which mounts
/// requireAuth alongside the handler. Declaring this type without that helper
/// fails to compile, so the guarantee cannot be silently broken.
export type AuthorizedRequest<
  TBody = void,
  TQuery = unknown,
  TParams extends ParamsDictionary = ParamsDictionary,
> = BaseRequest<TBody, TQuery, TParams> & {
  userId: string;
};

/// Response body is the success payload. The error shape is always possible,
/// because the global error handler may take over.
export type TypedResponse<TBody = void> = Response<TBody | ErrorResponse>;

export type UnauthorizedHandler<
  TBody = void,
  TQuery = unknown,
  TParams extends ParamsDictionary = ParamsDictionary,
  TResBody = unknown,
> = (
  req: UnauthorizedRequest<TBody, TQuery, TParams>,
  res: TypedResponse<TResBody>,
  next: NextFunction,
) => Promise<void>;

export type AuthorizedHandler<
  TBody = void,
  TQuery = unknown,
  TParams extends ParamsDictionary = ParamsDictionary,
  TResBody = unknown,
> = (
  req: AuthorizedRequest<TBody, TQuery, TParams>,
  res: TypedResponse<TResBody>,
  next: NextFunction,
) => Promise<void>;

/// Params carried by routes in this API. Declared once so the per-controller
/// generics stay readable.
export interface UserIdParams extends ParamsDictionary {
  userId: string;
}

export interface RecipeIdParams extends ParamsDictionary {
  recipeId: string;
}

export interface PostIdParams extends ParamsDictionary {
  postId: string;
}

export interface PostImageParams extends ParamsDictionary {
  postId: string;
  imageId: string;
}

export interface PostCommentParams extends ParamsDictionary {
  postId: string;
  commentId: string;
}

export interface ProductIdParams extends ParamsDictionary {
  productId: string;
}

export interface CollectionIdParams extends ParamsDictionary {
  collectionId: string;
}

export interface CollectionRecipeParams extends ParamsDictionary {
  collectionId: string;
  recipeId: string;
}
