import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'info' : 'debug',
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
