import type { Request, Response } from 'express';
import { getUserId } from '../middleware/auth';
import * as authService from '../services/auth.service';
import type { LoginInput, LogoutInput, RefreshInput, RegisterInput } from '../dto/auth.dto';

export async function register(req: Request, res: Response): Promise<void> {
  const input: RegisterInput = req.body;
  const result = await authService.register(input);
  res.status(201).json(result);
}

export async function login(req: Request, res: Response): Promise<void> {
  const input: LoginInput = req.body;
  const result = await authService.login(input);
  res.status(200).json(result);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const input: RefreshInput = req.body;
  const result = await authService.refresh(input.refreshToken);
  res.status(200).json(result);
}

export async function logout(req: Request, res: Response): Promise<void> {
  const input: LogoutInput = req.body;
  const userId = getUserId(req);
  await authService.logout(userId, input.refreshToken);
  res.status(204).send();
}
