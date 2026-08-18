import { logger } from './logger';

/**
 * Audit logging for security-relevant record access: who touched which
 * record, so "who read or changed my data" and "what's the blast radius of
 * this compromised account" both have an answer. This is deliberately
 * separate from pino-http's per-request traffic log (method/path/status/
 * timing) - that log proves a request happened, not who acted on what.
 *
 * WHAT THIS IS: one structured line per event, emitted through the same
 * pino logger as everything else and tagged `audit: true` so it can be
 * filtered or shipped separately by whatever log aggregator the host already
 * runs.
 *
 * WHAT THIS IS NOT: a database table. A table means a schema migration, an
 * unbounded row count, and a retention/erasure policy this project has not
 * designed (e.g. what happens to a user's audit trail when they request
 * account deletion?). The log shipper the host already has for every other
 * log line is the right place for this; audit events ride the same stream
 * instead of duplicating that infrastructure.
 *
 * HOW TO SEARCH: every event carries `requestId` when it originates from an
 * HTTP request - the same id pino-http attaches to that request's access-log
 * line and that the response carries in `X-Request-Id`. Grepping (or the
 * equivalent query in the log aggregator) for that id finds the audit
 * event(s) alongside the request that caused them. Events with no
 * originating request (e.g. the scheduled account-purge script) omit it.
 *
 * WHAT IS LOGGED: user ids (never emails or usernames), the action taken,
 * the resource type/id acted on, and the outcome.
 *
 * WHAT IS DELIBERATELY NOT LOGGED: passwords, password hashes, tokens of any
 * kind, or email addresses. Logging an email would be an identity leak into
 * a stream this module does not treat as sensitive-data-safe - the same
 * reason the base logger in lib/logger.ts already redacts credentials.
 * `meta` exists for extra context but must never carry any of the above;
 * every call site in this codebase is expected to pass only plain,
 * non-identifying values there.
 */

export type AuditAction =
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.login.locked_out'
  | 'auth.logout'
  | 'auth.refresh.success'
  | 'auth.refresh.reuse_detected'
  | 'account.deletion.requested'
  | 'account.deletion.cancelled'
  | 'account.purged'
  | 'authorization.denied'
  | 'post.created'
  | 'post.updated'
  | 'post.deleted'
  | 'recipe.created'
  | 'recipe.updated'
  | 'recipe.deleted'
  | 'comment.deleted_by_post_owner';

export type AuditResourceType = 'user' | 'post' | 'recipe' | 'comment';

export interface AuditEvent {
  /** What happened. */
  action: AuditAction;
  /** Who did it. Null for an unauthenticated caller (e.g. an unknown-email login attempt). */
  actorId: string | null;
  /** What kind of record was touched, when the action targets one. */
  resourceType?: AuditResourceType;
  /** Which record, when the action targets one. */
  resourceId?: string;
  /**
   * pino-http's request id, joining this event to the HTTP access log and to
   * the response's X-Request-Id. Omitted for events with no originating HTTP
   * request (e.g. the scheduled purge script).
   */
  requestId?: string;
  outcome: 'success' | 'failure';
  /** Extra non-sensitive context. Never put emails, tokens, or credentials here. */
  meta?: Record<string, string | number | boolean | null>;
}

/**
 * Emits one audit log line. Never throws: a failure here must never fail the
 * request it is describing, so any error from the underlying logger is
 * swallowed rather than propagated.
 */
export function recordAuditEvent(event: AuditEvent): void {
  try {
    logger.info({ audit: true, ...event }, `audit: ${event.action}`);
  } catch {
    // Audit logging must never break the request it is describing.
  }
}
