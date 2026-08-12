import type { NextFunction, Request, Response } from 'express';
import type { ParamsDictionary } from 'express-serve-static-core';

export interface ErrorResponse {
  error: { code: string; message: string; details?: unknown };
}

/// Request whose body, query and params carry the types that `validate()`
/// actually wrote at runtime.
///
/// `query` is intersected rather than declared on an interface extending
/// Request, because Express types it as ParsedQs (string | string[] only),
/// which cannot express the numbers and arrays zod coercion produces.
export type TypedRequest<
  TBody = void,
  TQuery = unknown,
  TParams extends ParamsDictionary = ParamsDictionary,
> = Omit<Request<TParams, unknown, TBody>, 'query'> & {
  query: TQuery;
};

/// Response body is the success payload; the error shape is always possible
/// because the global error handler may take over.
export type TypedResponse<TBody = void> = Response<TBody | ErrorResponse>;

export type TypedHandler<
  TBody = void,
  TQuery = unknown,
  TParams extends ParamsDictionary = ParamsDictionary,
  TResBody = unknown,
> = (
  req: TypedRequest<TBody, TQuery, TParams>,
  res: TypedResponse<TResBody>,
  next: NextFunction,
) => Promise<void>;

/// Params carried by routes in this API. Declaring them once keeps the
/// per-controller generics readable.
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
