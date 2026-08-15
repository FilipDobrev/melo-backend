import { BadRequestError } from '../lib/errors';
import * as userService from '../services/user.service';
import type { MeUser, PublicProfile, PublicUser } from '../services/user.service';
import type { CreateUploadUrlResult } from '../services/storage.service';
import type { AvatarUploadUrlInput, SearchUsersQuery, UpdateMeInput } from '../dto/user.dto';
import type { Page } from '../lib/pagination';
import type {
  AuthorizedRequest,
  TypedResponse,
  UnauthorizedRequest,
  UserIdParams,
} from '../types/http';

/** Gets the caller's own profile. */
export async function getMe(req: AuthorizedRequest, res: TypedResponse<MeUser>): Promise<void> {
  const user = await userService.getMe(req.userId);
  res.status(200).json(user);
}

/** Updates the caller's own profile. */
export async function updateMe(
  req: AuthorizedRequest<UpdateMeInput>,
  res: TypedResponse<MeUser>,
): Promise<void> {
  const user = await userService.updateMe(req.userId, req.body);
  res.status(200).json(user);
}

/** Gets another user's public profile. */
export async function getPublicProfile(
  req: UnauthorizedRequest<void, unknown, UserIdParams>,
  res: TypedResponse<PublicProfile>,
): Promise<void> {
  const { userId } = req.params;
  // Always present at runtime: userIdParamsSchema requires it via validate().
  // TS still needs a narrowing check because noUncheckedIndexedAccess widens
  // ParamsDictionary access to `string | undefined`.
  if (!userId) throw new BadRequestError('userId is required');
  const profile = await userService.getPublicProfile(userId, req.userId);
  res.status(200).json(profile);
}

/** Requests a presigned URL to upload a new avatar. */
export async function createAvatarUploadUrl(
  req: AuthorizedRequest<AvatarUploadUrlInput>,
  res: TypedResponse<CreateUploadUrlResult>,
): Promise<void> {
  const result = await userService.createAvatarUploadUrl(
    req.userId,
    req.body.contentType,
    req.body.contentLength,
  );
  res.status(200).json(result);
}

/** Searches users by name. */
export async function searchUsers(
  req: UnauthorizedRequest<void, SearchUsersQuery>,
  res: TypedResponse<Page<PublicUser>>,
): Promise<void> {
  const page = await userService.searchUsers(req.query);
  res.status(200).json(page);
}
