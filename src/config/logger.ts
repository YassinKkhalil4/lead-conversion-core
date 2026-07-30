import pino from 'pino';
import { getEnv } from './env.js';

export const logger = pino({
  level: getEnv().LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.x-edge-secret',
      'req.headers.x-internal-secret',
      '*.token',
      '*.access_token',
    ],
    censor: '**redacted**',
  },
});
