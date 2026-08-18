# Audit logging

Deliberate logging of who touched which record, distinct from the
traffic log pino-http already emits for every request (method, path,
status, timing, request id). The traffic log proves a request happened;
audit logging answers "who read or changed this record", which is the
question that actually matters when a user asks what happened to their
data, or an account is suspected compromised and you need the blast
radius.

The module is `src/lib/audit.ts`. It owns the shape of every event so
call sites cannot each invent their own ad-hoc `logger.info` payload.
Call it with `recordAuditEvent(event)`; see the module for the full
`AuditEvent` type.

## What is logged

- **Authentication**: login success, login failure, account locked out
  (see the per-account lockout in `src/services/loginLockout.service.ts`),
  logout, refresh success, refresh-token reuse detection.
- **Account lifecycle**: deletion requested, deletion cancelled, and the
  eventual purge once the grace period elapses.
- **Authorization failures**: every `403` response, logged once, centrally,
  from `src/middleware/error.ts` - not scattered at each call site that
  throws `ForbiddenError`, so a new one can't forget to log it.
- **Mutation of visible content**: post and recipe create/update/delete
  by their owner, and a comment deleted by the post's owner moderating
  someone else's comment (deleting your own comment is not logged - it
  is not access to someone else's content).

Each event carries: who (a user id, or `null` for an anonymous/unknown
caller), what action, the resource type and id when the action targets
one, the outcome (`success`/`failure`), and - for anything with an
originating HTTP request - the request id.

## What is deliberately not logged

- Passwords, password hashes, or tokens of any kind.
- Email addresses or usernames. Only user ids are logged; an id alone
  does not identify anyone without a database lookup, keeping this log
  stream at a lower sensitivity than the accounts it describes.
- Ordinary reads. Only mutations and rejections are audited - logging
  every read would drown the signal and add cost to the read path for
  no real benefit here (this is not a regulated-data system with a
  legal "who viewed this record" requirement).
- A user deleting their own content (own post, own recipe, own comment)
  is not an access to someone else's data and is not audited beyond the
  ordinary traffic log.

## Storage: a log stream, not a database table

Audit events are structured lines in the same pino stream as every
other log line, tagged `audit: true`. This is intentional:

- No schema migration. A database table for audit events implies a
  retention and erasure policy this project has not designed (what
  happens to a user's audit trail when they request account deletion?)
  and an unbounded, ever-growing row count with no cleanup story.
- The host's log shipper - whatever already aggregates this process's
  stdout/stderr in production - already solves storage, rotation, and
  retention for every other log line this app emits. Audit events ride
  the same pipe instead of duplicating that infrastructure.

If a real compliance requirement for structured, queryable, long-term
audit storage ever emerges, that is a deliberate follow-up (a dedicated
audit sink with its own retention policy), not something to bolt onto
this module by adding a Prisma model to it.

## Searching by request id

Every event with an originating HTTP request carries `requestId` - the
same id pino-http attaches to that request's access-log line, and that
the response carries in `X-Request-Id`. Given a request id (e.g. handed
to support by a user, or pulled from an incident's access log), grep
the log stream (or run the equivalent query in whatever aggregates
these logs in production) for that id to find both the request and any
audit events it produced:

```
grep '"requestId":"<the-id>"' <log output>
```

Events with no originating HTTP request (the scheduled
`scripts/purge-deleted-users.ts` run) omit `requestId` and are found by
`action` and `resourceId` (the purged user's id) instead.
