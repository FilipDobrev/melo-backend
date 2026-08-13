import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  // The integration suite boots the real app per test file and exercises it
  // over HTTP, so pino-http would otherwise emit a request/response log line
  // per call and drown the test reporter's output.
  level: env.NODE_ENV === 'test' ? 'silent' : env.NODE_ENV === 'production' ? 'info' : 'debug',
  // Never let credentials or tokens reach the log stream.
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.refreshToken',
      'password',
      'passwordHash',
      'refreshToken',
      'accessToken',
    ],
    censor: '[redacted]',
  },
});
