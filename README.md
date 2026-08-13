# Melo API

Express + TypeScript + Prisma + PostgreSQL backend for Melo, a recipe and meal-sharing app.

See [API.md](./API.md) for the full endpoint contract.

## Requirements

- Node 22+
- Docker (for local Postgres and S3-compatible storage)

## Getting started

```bash
npm install
cp .env.example .env          # then edit the secrets
docker compose up -d          # Postgres on 5432, MinIO on 9000/9001
npm run prisma:migrate        # creates the schema
npm run prisma:seed           # categories + starter products
npm run dev                   # http://localhost:4000
```

Health check: `GET /health`.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Watch-mode dev server |
| `npm run build` / `npm start` | Compile to `dist/` and run |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests (pure functions, no database) |
| `npm run test:integration` | Vitest integration tests (real Postgres + supertest, see below) |
| `npm run prisma:migrate` | Apply a dev migration |
| `npm run prisma:seed` | Idempotent seed of categories and products |

## Integration tests

`tests/integration/` boots the real Express app (`createApp()`) with supertest
against a real Postgres database - `/api/v1/...` requests go through routing,
validation, auth and Prisma exactly as they would in production. This is
where authorization (who can edit/delete whose data) and cross-cutting
contracts (auth token rotation, cursor pagination, nutrition totals) are
verified; `npm test` only covers pure functions.

Setup:

1. Add `TEST_DATABASE_URL` to your `.env` (see `.env.example`). It must point
   at a **different database** than `DATABASE_URL` - the suite truncates
   every table between tests, so pointing it at your dev database would wipe
   it.
2. `docker compose up -d` (same Postgres container, different database).
3. `npm run test:integration` - this first runs `prisma db push` against
   `TEST_DATABASE_URL` (creating the `melo_test` database and syncing the
   schema if needed, via the `pretest:integration` script), then runs the
   suite.

The table list used for per-test truncation (`tests/integration/global-hooks.ts`)
is read from Prisma's own DMMF metadata rather than hand-written, so a newly
added model is truncated automatically instead of silently leaking state
between tests.

Test data factories (register a user, create a product/recipe/post/collection)
live in `tests/integration/helpers/factories.ts` - plain functions that call
the real HTTP endpoints, so a broken endpoint fails the factory itself
instead of silently seeding data the API could never have produced.

## Architecture

Requests flow through four layers, and each layer only talks to the next:

```
routes/  ->  controllers/  ->  services/  ->  repositories/  ->  Prisma
```

- **routes** wire paths to handlers, apply `validate()` and `requireAuth` / `optionalAuth`.
- **controllers** read the request, call one service, send the response. No business logic.
- **services** hold business logic and every authorization decision. They never touch Prisma.
- **repositories** are the only place Prisma is used. Each function accepts an optional `Db`, so callers can run it inside a transaction.

Supporting folders: `dto/` (zod schemas), `middleware/`, `lib/` (errors, logger, pagination, Prisma client), `config/` (validated env).

## Conventions

- Every response error is `{ error: { code, message, details? } }`.
- Lists use cursor pagination: `?cursor=<uuid>&limit=<1..50>`, returning `{ items, nextCursor }`.
- Multi-write operations run inside `prisma.$transaction`.
- Uniqueness is enforced by database constraints, and `P2002` is mapped to a `409`.

## Security notes

- Passwords are bcrypt hashed. Refresh tokens are opaque random strings stored only as SHA-256 hashes, and they rotate on every use.
- Access tokens are short-lived JWTs, default 15 minutes.
- Login failures are indistinguishable between "unknown email" and "wrong password".
- The logger redacts authorization headers, passwords, and tokens.
- Image uploads go directly to object storage via presigned PUT URLs. The database stores only the object key.
