import { prisma } from '../src/lib/prisma';
import { logger } from '../src/lib/logger';
import { purgeEligibleUsers } from '../src/services/accountPurge.service';

/**
 * Finds every account whose deletion grace period
 * (ACCOUNT_DELETION_GRACE_PERIOD_DAYS, default 30) has elapsed and purges
 * them for good: reassigns any recipe another user's post still depends on
 * to a reserved tombstone account, deletes the user's stored images, then
 * deletes the user row and lets the schema's cascades remove the rest. Safe
 * to run repeatedly (idempotent tombstone creation, nothing to do once every
 * eligible user is purged) and safe to run on a schedule (e.g. daily cron),
 * mirroring scripts/prune-refresh-tokens.ts.
 */
async function main(): Promise<void> {
  const results = await purgeEligibleUsers();
  logger.info({ purgedCount: results.length }, 'purged deleted users');
}

main()
  .catch((error) => {
    logger.error({ error }, 'failed to purge deleted users');
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
