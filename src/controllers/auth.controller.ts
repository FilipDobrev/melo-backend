import * as authService from '../services/auth.service';
import type { AuthResult, RefreshResult } from '../services/auth.service';
import type { LoginInput, LogoutInput, RefreshInput, RegisterInput } from '../dto/auth.dto';
import type { AuthorizedRequest, TypedResponse, UnauthorizedRequest } from '../types/http';

export async function register(
  req: UnauthorizedRequest<RegisterInput>,
  res: TypedResponse<AuthResult>,
): Promise<void> {
  const result = await authService.register(req.body);
  res.status(201).json(result);
}

export async function login(
  req: UnauthorizedRequest<LoginInput>,
  res: TypedResponse<AuthResult>,
): Promise<void> {
  const result = await authService.login(req.body);
  res.status(200).json(result);
}

export async function refresh(
  req: UnauthorizedRequest<RefreshInput>,
  res: TypedResponse<RefreshResult>,
): Promise<void> {
  const result = await authService.refresh(req.body.refreshToken);
  res.status(200).json(result);
}

export async function logout(
  req: AuthorizedRequest<LogoutInput>,
  res: TypedResponse<void>,
): Promise<void> {
  await authService.logout(req.userId, req.body.refreshToken);
  res.status(204).send();
}
