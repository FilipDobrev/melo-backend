import { prisma } from '../src/lib/prisma';
import { logger } from '../src/lib/logger';
import * as refreshTokenRepository from '../src/repositories/refreshToken.repository';

// Grace period before a revoked row is actually deleted. Expired rows are
// deleted immediately - expiry alone is not a security signal, just a stale
// row - but revoked rows are the evidence reuse-detection depends on (see
// refresh() in src/services/auth.service.ts): if an attacker replays a
// stolen-but-already-rotated token, we only notice because the row is still
// there and marked revoked. Deleting it too eagerly would turn that replay
// into a lookup of an unknown token, which is treated as an ordinary
// rejection instead of triggering a full session-family revocation. Seven
// days comfortably covers the realistic delay between a token being stolen
// and an attacker getting around to using it, without letting revoked rows
// accumulate forever.
const REVOKED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

async function main(): Promise<void> {
  const { count } = await refreshTokenRepository.deleteStale(REVOKED_GRACE_MS);
  logger.info({ count }, 'pruned stale refresh tokens');
}

main()
  .catch((error) => {
    logger.error({ error }, 'failed to prune refresh tokens');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
