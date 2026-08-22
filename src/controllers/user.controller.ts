import { BadRequestError } from '../lib/errors';
import { recordAuditEvent } from '../lib/audit';
import * as userService from '../services/user.service';
import type { MeUser, PublicProfile, PublicUser } from '../services/user.service';
import * as exportService from '../services/export.service';
import type { UserDataExport } from '../services/export.service';
import type { CreateUploadUrlResult } from '../services/storage.service';
import type { AvatarUploadUrlInput, DeleteMeInput, SearchUsersQuery, UpdateMeInput } from '../dto/user.dto';
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

/** Requests deletion of the caller's own account, after verifying their password. Responds 204. */
export async function deleteMe(
  req: AuthorizedRequest<DeleteMeInput>,
  res: TypedResponse<void>,
): Promise<void> {
  await userService.deleteMe(req.userId, req.body.password);
  recordAuditEvent({
    action: 'account.deletion.requested',
    actorId: req.userId,
    resourceType: 'user',
    resourceId: req.userId,
    requestId: String(req.id),
    outcome: 'success',
  });
  res.status(204).send();
}

/** Cancels a pending deletion of the caller's own account. Responds 204. */
export async function restoreMe(req: AuthorizedRequest, res: TypedResponse<void>): Promise<void> {
  await userService.restoreMe(req.userId);
  recordAuditEvent({
    action: 'account.deletion.cancelled',
    actorId: req.userId,
    resourceType: 'user',
    resourceId: req.userId,
    requestId: String(req.id),
    outcome: 'success',
  });
  res.status(204).send();
}

/**
 * Exports everything the service holds about the caller, for GDPR Article 20
 * data portability. Available to a pending-deletion account too - see
 * export.service.ts.
 */
export async function exportMe(
  req: AuthorizedRequest,
  res: TypedResponse<UserDataExport>,
): Promise<void> {
  const data = await exportService.getUserDataExport(req.userId);
  recordAuditEvent({
    action: 'account.data_exported',
    actorId: req.userId,
    resourceType: 'user',
    resourceId: req.userId,
    requestId: String(req.id),
    outcome: 'success',
  });
  res.status(200);
  res.setHeader('Content-Disposition', `attachment; filename="melo-data-export-${req.userId}.json"`);
  res.json(data);
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
