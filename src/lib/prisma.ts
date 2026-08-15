import { PrismaClient } from '@prisma/client';
import { env } from '../config/env';

/** Shared Prisma client for the process. */
export const prisma = new PrismaClient({
  log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

/**
 * Transaction client type, so repositories can accept either the base
 * client or an interactive transaction without widening to `any`.
 */
export type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Either the base Prisma client or a transaction handle - what repository functions accept. */
export type Db = PrismaClient | PrismaTx;
