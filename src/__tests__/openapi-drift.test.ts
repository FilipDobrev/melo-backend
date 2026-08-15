import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';

/** Guards against the OpenAPI description (openapi/) silently drifting from
 * the Express routes it claims to document. Runs in the fast unit suite
 * (`npm test`): it needs no database and no HTTP server, just the route
 * table Express builds when the app module is constructed, and the
 * bundled OpenAPI document. See openapi/CONVENTIONS.md for the authoring
 * rules this test enforces indirectly.
 */

const HTTP_METHODS = new Set(['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']);

/** The subset of Express's undocumented internal `Layer`/`Route` shape this
 * file relies on to walk the router stack. Not exported by @types/express,
 * so this is a hand-written model of what Express 4 actually builds -
 * verified against the installed express version, not guessed.
 */
interface ExpressRouteLayer {
  name: string;
  regexp: RegExp;
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
  handle?: {
    stack?: ExpressRouteLayer[];
  };
}

interface RouteEntry {
  method: string;
  path: string;
}

/** Express never stores a mounted sub-router's literal prefix as a string;
 * only the compiled matcher regexp survives on the layer. Every
 * `router.use(prefix, subRouter)` in this codebase (src/routes/index.ts,
 * user.routes.ts, recipe.routes.ts) mounts at a static, param-free prefix,
 * or with no prefix at all (`router.use(subRouter)`, used by user.routes.ts
 * to compose the follow/cookbook/collection/post/recipe sub-routers at the
 * same level as their parent). path-to-regexp 0.1.x (Express 4's bundled
 * version) compiles a static prefix to exactly
 * `^\/<literal>\/?(?=\/|$)`, and a no-prefix/root mount to `^\/?(?=\/|$)`.
 * Recovering the literal prefix from that fixed shape is safe here; it
 * would not be for a mount prefix containing a `:param`, which this
 * codebase never does.
 */
function extractMountPrefix(regexp: RegExp): string {
  if (/^\^\\\/\?\(\?=\\\/\|\$\)$/.test(regexp.source)) return '';
  const match = /^\^\\\/(.+)\\\/\?\(\?=\\\/\|\$\)$/.exec(regexp.source);
  const literal = match?.[1];
  if (literal === undefined) {
    throw new Error(
      `openapi-drift test: unrecognised router mount pattern "${regexp.source}". ` +
        'This usually means a new router is mounted with a parameterised prefix ' +
        '(e.g. router.use("/:x", sub)), which extractMountPrefix does not handle.',
    );
  }
  return `/${literal.replace(/\\\//g, '/')}`;
}

/** Recursively walks an Express router's layer stack, following mounted
 * sub-routers (user.routes.ts alone nests three levels: apiRouter ->
 * userRouter -> followRouter/collectionRouter/etc.), and collects every
 * method+path pair actually registered.
 */
function collectExpressRoutes(stack: ExpressRouteLayer[], prefix: string, out: RouteEntry[]): void {
  for (const layer of stack) {
    if (layer.route) {
      const methods = Object.entries(layer.route.methods)
        .filter(([, enabled]) => enabled)
        .map(([method]) => method.toUpperCase());
      for (const method of methods) {
        out.push({ method, path: `${prefix}${layer.route.path}` });
      }
    } else if (layer.name === 'router' && layer.handle?.stack) {
      collectExpressRoutes(layer.handle.stack, prefix + extractMountPrefix(layer.regexp), out);
    }
  }
}

function getExpressRoutes(app: Express): RouteEntry[] {
  const stack = (app as unknown as { _router: { stack: ExpressRouteLayer[] } })._router.stack;
  const routes: RouteEntry[] = [];
  collectExpressRoutes(stack, '', routes);
  return routes;
}

interface BundledOpenApi {
  paths: Record<string, Record<string, unknown>>;
}

/** Bundles openapi/openapi.yaml to a throwaway JSON file via the same
 * redocly CLI `npm run openapi:bundle` uses, so this test can never pass
 * against a stale copy of the multi-file description - it always reflects
 * the files on disk right now. Invoked as `node <redocly's cli.js>` rather
 * than through the `redocly`/`redocly.cmd` shim so it runs identically on
 * Windows and POSIX without a shell in between.
 */
function bundleOpenApi(): BundledOpenApi {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const cli = path.join(repoRoot, 'node_modules', '@redocly', 'cli', 'bin', 'cli.js');
  const outFile = path.join(os.tmpdir(), `melo-openapi-bundle-${process.pid}.json`);
  try {
    execFileSync(
      process.execPath,
      [cli, 'bundle', 'openapi/openapi.yaml', '--ext', 'json', '-o', outFile],
      { cwd: repoRoot, stdio: 'pipe' },
    );
    return JSON.parse(fs.readFileSync(outFile, 'utf8')) as BundledOpenApi;
  } finally {
    fs.rmSync(outFile, { force: true });
  }
}

function getOpenApiOperations(bundle: BundledOpenApi): RouteEntry[] {
  const operations: RouteEntry[] = [];
  for (const [openApiPath, pathItem] of Object.entries(bundle.paths)) {
    for (const key of Object.keys(pathItem)) {
      if (HTTP_METHODS.has(key)) {
        operations.push({ method: key.toUpperCase(), path: openApiPath });
      }
    }
  }
  return operations;
}

/** Puts an Express route and an OpenAPI operation into one comparable form:
 * Express's `:userId` becomes OpenAPI's `{userId}`, a trailing slash is
 * dropped (Express and OpenAPI both treat `/foo` and `/foo/` as the same
 * resource here), and the `/api/v1` prefix - present on every mounted
 * Express route except the two health checks, and absent from every
 * OpenAPI path key, including the health ones (see
 * openapi/paths/health/*.yaml's path-level `servers` override) - is
 * stripped so both sides read the same for those two too.
 */
function normaliseRoute(route: RouteEntry): string {
  let normalisedPath = route.path.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  normalisedPath = normalisedPath.replace(/^\/api\/v1(?=\/|$)/, '');
  if (normalisedPath.length > 1 && normalisedPath.endsWith('/')) {
    normalisedPath = normalisedPath.slice(0, -1);
  }
  if (normalisedPath === '') normalisedPath = '/';
  return `${route.method} ${normalisedPath}`;
}

describe('OpenAPI description matches the mounted Express routes', () => {
  let expressRouteKeys: Set<string>;
  let openApiOperationKeys: Set<string>;

  beforeAll(async () => {
    // process.env is set here, before createApp() is imported, because
    // config/env validates required vars eagerly at import time. A dynamic
    // import (rather than a static one) is required for that ordering: ES
    // imports are hoisted above a module's own top-level code, so a static
    // `import { createApp } from '../app'` would run before these
    // assignments regardless of where it appears in the file.
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL ??= 'postgresql://user:pass@localhost:5432/melo_openapi_drift_test';
    process.env.JWT_ACCESS_SECRET ??= 'openapi-drift-test-access-secret-key';
    process.env.JWT_REFRESH_SECRET ??= 'openapi-drift-test-refresh-secret-key';
    process.env.S3_BUCKET ??= 'openapi-drift-test-bucket';
    process.env.S3_REGION ??= 'eu-central-1';
    process.env.S3_ACCESS_KEY_ID ??= 'openapi-drift-test';
    process.env.S3_SECRET_ACCESS_KEY ??= 'openapi-drift-test';

    const { createApp } = await import('../app');
    const expressRoutes = getExpressRoutes(createApp());
    const openApiOperations = getOpenApiOperations(bundleOpenApi());

    expressRouteKeys = new Set(expressRoutes.map(normaliseRoute));
    openApiOperationKeys = new Set(openApiOperations.map(normaliseRoute));
  }, 30_000);

  it('found a realistic number of routes on both sides', () => {
    // A sanity floor, not an exact count: if either side collapses to a
    // handful of entries, the walker or the bundler broke silently instead
    // of the routes actually disappearing, and the drift checks below would
    // pass for the wrong reason.
    expect(expressRouteKeys.size).toBeGreaterThan(30);
    expect(openApiOperationKeys.size).toBeGreaterThan(30);
  });

  it('has no undocumented or phantom-documented routes', () => {
    const undocumented = [...expressRouteKeys]
      .filter((key) => !openApiOperationKeys.has(key))
      .sort();
    const unmounted = [...openApiOperationKeys]
      .filter((key) => !expressRouteKeys.has(key))
      .sort();

    const message = [
      undocumented.length > 0
        ? [
            'Routes mounted in Express but missing from openapi/ (add a path file and wire it into openapi.yaml):',
            ...undocumented.map((key) => `  ${key}`),
          ].join('\n')
        : null,
      unmounted.length > 0
        ? [
            'Operations documented in openapi/ but not mounted in Express (fix the path/method, or remove the operation):',
            ...unmounted.map((key) => `  ${key}`),
          ].join('\n')
        : null,
    ]
      .filter((section): section is string => section !== null)
      .join('\n\n');

    expect(undocumented, message).toEqual([]);
    expect(unmounted, message).toEqual([]);
  });
});
