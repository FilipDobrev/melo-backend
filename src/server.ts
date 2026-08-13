import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';

/// Ceiling on graceful shutdown: if in-flight requests have not drained by
/// then, something is stuck (a hung connection, a runaway query) and we
/// force-exit rather than let a container's SIGKILL grace period run out
/// silently.
const SHUTDOWN_TIMEOUT_MS = 10_000;

const app = createApp();
const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'Melo API listening');
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  // A second SIGTERM/SIGINT while we are already draining must not kick off
  // a second shutdown race against the same server/prisma handles.
  if (shuttingDown) {
    logger.info({ signal }, 'Shutdown already in progress, ignoring signal');
    return;
  }
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  const closeServer = new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });

  const timeout = new Promise<'timeout'>((resolve) => {
    setTimeout(() => resolve('timeout'), SHUTDOWN_TIMEOUT_MS).unref();
  });

  const outcome = await Promise.race([closeServer.then(() => 'closed' as const), timeout]);

  if (outcome === 'timeout') {
    logger.error({ signal }, 'Shutdown timed out waiting for in-flight requests, forcing exit');
    process.exit(1);
  }

  try {
    await prisma.$disconnect();
    logger.info({ signal }, 'Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err, signal }, 'Error disconnecting Prisma during shutdown');
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
