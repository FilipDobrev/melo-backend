import { getUserId } from '../middleware/auth';
import * as authService from '../services/auth.service';
import type { AuthResult, RefreshResult } from '../services/auth.service';
import type { LoginInput, LogoutInput, RefreshInput, RegisterInput } from '../dto/auth.dto';
import type { TypedRequest, TypedResponse } from '../types/http';

export async function register(
  req: TypedRequest<RegisterInput>,
  res: TypedResponse<AuthResult>,
): Promise<void> {
  const result = await authService.register(req.body);
  res.status(201).json(result);
}

export async function login(
  req: TypedRequest<LoginInput>,
  res: TypedResponse<AuthResult>,
): Promise<void> {
  const result = await authService.login(req.body);
  res.status(200).json(result);
}

export async function refresh(
  req: TypedRequest<RefreshInput>,
  res: TypedResponse<RefreshResult>,
): Promise<void> {
  const result = await authService.refresh(req.body.refreshToken);
  res.status(200).json(result);
}

export async function logout(
  req: TypedRequest<LogoutInput>,
  res: TypedResponse<void>,
): Promise<void> {
  await authService.logout(getUserId(req), req.body.refreshToken);
  res.status(204).send();
}
