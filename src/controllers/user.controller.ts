import type { Request, Response } from 'express';
import { getUserId } from '../middleware/auth';
import { BadRequestError } from '../lib/errors';
import * as userService from '../services/user.service';
import type { SearchUsersQuery, UpdateMeInput } from '../dto/user.dto';

export async function getMe(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const user = await userService.getMe(userId);
  res.status(200).json(user);
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  const userId = getUserId(req);
  const input: UpdateMeInput = req.body;
  const user = await userService.updateMe(userId, input);
  res.status(200).json(user);
}

export async function getPublicProfile(req: Request, res: Response): Promise<void> {
  const { userId } = req.params;
  // Always present at runtime: userIdParamsSchema requires it via validate().
  // TS still needs a narrowing check because noUncheckedIndexedAccess widens
  // ParamsDictionary access to `string | undefined`.
  if (!userId) throw new BadRequestError('userId is required');
  const profile = await userService.getPublicProfile(userId, req.user?.id);
  res.status(200).json(profile);
}

export async function searchUsers(req: Request, res: Response): Promise<void> {
  // req.query's ambient Express type (ParsedQs) predates the validate()
  // middleware overwriting it with the parsed, typed query object.
  const query = req.query as unknown as SearchUsersQuery;
  const page = await userService.searchUsers(query);
  res.status(200).json(page);
}
