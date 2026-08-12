import { BadRequestError } from '../lib/errors';
import { getOptionalUserId, getUserId } from '../middleware/auth';
import * as userService from '../services/user.service';
import type { MeUser, PublicProfile, PublicUser } from '../services/user.service';
import type { SearchUsersQuery, UpdateMeInput } from '../dto/user.dto';
import type { Page } from '../lib/pagination';
import type { TypedRequest, TypedResponse, UserIdParams } from '../types/http';

export async function getMe(req: TypedRequest, res: TypedResponse<MeUser>): Promise<void> {
  const user = await userService.getMe(getUserId(req));
  res.status(200).json(user);
}

export async function updateMe(
  req: TypedRequest<UpdateMeInput>,
  res: TypedResponse<MeUser>,
): Promise<void> {
  const user = await userService.updateMe(getUserId(req), req.body);
  res.status(200).json(user);
}

export async function getPublicProfile(
  req: TypedRequest<void, unknown, UserIdParams>,
  res: TypedResponse<PublicProfile>,
): Promise<void> {
  const { userId } = req.params;
  // Always present at runtime: userIdParamsSchema requires it via validate().
  // TS still needs a narrowing check because noUncheckedIndexedAccess widens
  // ParamsDictionary access to `string | undefined`.
  if (!userId) throw new BadRequestError('userId is required');
  const profile = await userService.getPublicProfile(userId, getOptionalUserId(req));
  res.status(200).json(profile);
}

export async function searchUsers(
  req: TypedRequest<void, SearchUsersQuery>,
  res: TypedResponse<Page<PublicUser>>,
): Promise<void> {
  const page = await userService.searchUsers(req.query);
  res.status(200).json(page);
}
