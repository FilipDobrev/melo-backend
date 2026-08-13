import path from 'node:path';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { errorHandler, notFoundHandler } from './middleware/error';
import { generalApiLimiter } from './middleware/rateLimit';
import { apiRouter } from './routes';

export function createApp(): express.Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.CORS_ORIGINS === '*' ? true : env.CORS_ORIGINS.split(',').map((o) => o.trim()),
      // The API authenticates with a Bearer access token, never cookies, so
      // requests carry no ambient browser credentials that "credentials"
      // would need to unlock. Leaving this true while origin can be "*"
      // is also rejected outright by browsers (they refuse credentialed
      // requests to a wildcard origin), so there is no upside to it either
      // way - just a footgun if CORS_ORIGINS is ever left at its default.
      credentials: false,
    }),
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(pinoHttp({ logger }));

  // Every response carries the same request id pino-http attached to its
  // log line, so a 5xx a user reports can be grepped for directly.
  app.use((req, res, next) => {
    res.setHeader('X-Request-Id', String(req.id));
    next();
  });

  // Liveness: answers as long as the process is up and the event loop is
  // free, nothing more. Must never depend on the database - a slow/unreachable
  // Postgres would otherwise make the orchestrator think the process itself
  // is unhealthy and restart it, which does nothing to fix a database blip.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Readiness: can this instance actually serve traffic right now. A failed
  // query means "not ready", not "process is broken", hence the separate
  // endpoint and the 503 rather than a crash.
  app.get('/health/ready', (_req, res) => {
    prisma.$queryRaw`SELECT 1`.then(
      () => res.json({ status: 'ok' }),
      (err: unknown) => {
        logger.error({ err }, 'Readiness check failed');
        res.status(503).json({ status: 'error', message: 'Database unreachable' });
      },
    );
  });

  // Preset recipe images are app assets shipped with the API, not user
  // content, so they are served straight off disk rather than through S3.
  app.use(
    '/static/recipe-presets',
    express.static(path.join(__dirname, '..', 'public', 'recipe-presets'), {
      maxAge: '1d',
      immutable: false,
    }),
  );

  app.use('/api/v1', generalApiLimiter, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
