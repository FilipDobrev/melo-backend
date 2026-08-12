import { getUserId } from '../middleware/auth';
import * as followService from '../services/follow.service';
import type { UserSummary } from '../repositories/follow.repository';
import type { ListFollowQuery } from '../dto/follow.dto';
import type { Page } from '../lib/pagination';
import type { TypedRequest, TypedResponse, UserIdParams } from '../types/http';

export async function follow(
  req: TypedRequest<void, unknown, UserIdParams>,
  res: TypedResponse<void>,
): Promise<void> {
  const { userId } = req.params;
  await followService.followUser(getUserId(req), userId);
  res.status(204).send();
}

export async function unfollow(
  req: TypedRequest<void, unknown, UserIdParams>,
  res: TypedResponse<void>,
): Promise<void> {
  const { userId } = req.params;
  await followService.unfollowUser(getUserId(req), userId);
  res.status(204).send();
}

export async function listFollowers(
  req: TypedRequest<void, ListFollowQuery, UserIdParams>,
  res: TypedResponse<Page<UserSummary>>,
): Promise<void> {
  const { userId } = req.params;
  const { cursor, limit } = req.query;
  const page = await followService.listFollowers(userId, cursor, limit);
  res.status(200).json(page);
}

export async function listFollowing(
  req: TypedRequest<void, ListFollowQuery, UserIdParams>,
  res: TypedResponse<Page<UserSummary>>,
): Promise<void> {
  const { userId } = req.params;
  const { cursor, limit } = req.query;
  const page = await followService.listFollowing(userId, cursor, limit);
  res.status(200).json(page);
}
