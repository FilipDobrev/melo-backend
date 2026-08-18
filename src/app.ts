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

/**
 * Helmet defaults are tuned for an HTML app; this API serves JSON plus a
 * handful of preset images, so only what actually matters here is adjusted:
 *
 * - HSTS: kept, but with an explicit max-age rather than helmet's default.
 *   180 days is long enough to matter (a returning client won't accidentally
 *   downgrade to HTTP) without committing to the 1-year + preload-list
 *   requirements that come with `preload: true`. `includeSubDomains` and
 *   `preload` are left off - both are effectively permanent, domain-wide
 *   commitments this app has no authority to make on behalf of whatever
 *   else might run on a subdomain, so an operator should opt in explicitly
 *   rather than have it imposed here.
 * - X-Content-Type-Options (nosniff): left at helmet's default (on). This
 *   is the one header that concretely matters for /static/recipe-presets -
 *   it stops a browser from sniffing a preset image's bytes as something
 *   executable (e.g. HTML) if the server's declared Content-Type is ever
 *   wrong, which is exactly the static-file-serving scenario this header
 *   exists for.
 * - Content-Security-Policy: left at helmet's default rather than dropped.
 *   It's inert for JSON responses (browsers don't execute anything from an
 *   `application/json` body), but it isn't inert for /static/recipe-presets:
 *   if a browser is ever pointed at that URL directly, a restrictive
 *   default-src/script-src is defense-in-depth against that path ever being
 *   used to serve or execute something other than an image.
 * - Cross-Origin-Resource-Policy: overridden from helmet's default
 *   (`same-origin`) to `cross-origin`. This API's whole point is to be
 *   called from other origins - CORS_ORIGINS defaults to "*" and preset
 *   images are fetched directly by clients on other origins - so the
 *   default would silently break exactly that.
 * - X-Powered-By: already removed by helmet's default `xPoweredBy` option;
 *   no override needed.
 */
const helmetOptions: Parameters<typeof helmet>[0] = {
  strictTransportSecurity: {
    maxAge: 15552000, // 180 days, in seconds
    includeSubDomains: false,
    preload: false,
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
};

/** Builds the Express app: middleware, health checks, static assets and API routes. */
export function createApp(): express.Express {
  const app = express();

  // Every real deployment (Render, Koyeb, Fly, a VPS behind nginx/Caddy)
  // terminates TLS at a reverse proxy, so `req.ip` and `req.secure` must be
  // derived from X-Forwarded-For/X-Forwarded-Proto rather than the socket,
  // which always belongs to the proxy. This has to be set before anything
  // that reads req.ip (the rate limiters below) or req.secure (the HTTPS
  // redirect below). TRUST_PROXY defaults to 0 (trust nothing), which is
  // correct for local dev where there is no proxy in front of the app.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(helmet(helmetOptions));
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

  // Redirects plain HTTP to HTTPS in production. `req.secure` reflects
  // X-Forwarded-Proto once `trust proxy` is set above, since the proxy -
  // not this process - terminates TLS. Skipped entirely outside production:
  // local dev has no TLS to redirect to, and orchestrator health probes
  // (below) are exempted because they commonly call over plain HTTP inside
  // the private network, before ever reaching a proxy.
  app.use((req, res, next) => {
    if (env.NODE_ENV !== 'production' || req.secure) {
      next();
      return;
    }
    if (req.path === '/health' || req.path === '/health/ready') {
      next();
      return;
    }
    res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
  });

  // The API accepts JSON only. `strict: true` (express's default, made
  // explicit here) rejects any body that isn't a JSON object/array, and
  // omitting a broader `type` means a body sent with a mismatched
  // Content-Type (e.g. text/plain, or none at all) is never parsed into
  // req.body - it's left empty, so downstream zod validation rejects it
  // with a normal 400 instead of a route silently reading attacker-shaped
  // data as if it were valid JSON.
  app.use(express.json({ limit: '1mb', strict: true, type: 'application/json' }));
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

  // Test-only: exposes the resolved client address so the integration
  // suite can prove TRUST_PROXY actually changes what req.ip (and
  // therefore every rate limiter) keys on, without reaching into
  // express-rate-limit's internals. Never mounted outside NODE_ENV=test.
  if (env.NODE_ENV === 'test') {
    app.get('/__test/ip', (req, res) => {
      res.json({ ip: req.ip });
    });
  }

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
