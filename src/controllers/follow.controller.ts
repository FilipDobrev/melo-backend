import type { Request, Response } from 'express';
import { getUserId } from '../middleware/auth';
import * as followService from '../services/follow.service';
import { followParamsSchema, listFollowQuerySchema } from '../dto/follow.dto';
import type { FollowParams, ListFollowQuery } from '../dto/follow.dto';

/// `validate()` already parsed req.params/req.query against these schemas
/// before the handler runs; re-parsing here just recovers the precise type
/// (Express types params/query as loose string dictionaries) without an
/// `as` assertion.
function params(req: Request): FollowParams {
  return followParamsSchema.parse(req.params);
}
function query(req: Request): ListFollowQuery {
  return listFollowQuerySchema.parse(req.query);
}

export async function follow(req: Request, res: Response): Promise<void> {
  const currentUserId = getUserId(req);
  const { userId } = params(req);
  await followService.followUser(currentUserId, userId);
  res.status(204).send();
}

export async function unfollow(req: Request, res: Response): Promise<void> {
  const currentUserId = getUserId(req);
  const { userId } = params(req);
  await followService.unfollowUser(currentUserId, userId);
  res.status(204).send();
}

export async function listFollowers(req: Request, res: Response): Promise<void> {
  const { userId } = params(req);
  const { cursor, limit } = query(req);
  const page = await followService.listFollowers(userId, cursor, limit);
  res.status(200).json(page);
}

export async function listFollowing(req: Request, res: Response): Promise<void> {
  const { userId } = params(req);
  const { cursor, limit } = query(req);
  const page = await followService.listFollowing(userId, cursor, limit);
  res.status(200).json(page);
}
