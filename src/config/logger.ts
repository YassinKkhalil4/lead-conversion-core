import pino from 'pino';
import { getEnv } from './env.js';
import { logRedactionCensor, serializeRequestForLog } from './log-redaction.js';

export const logger = pino({
  level: getEnv().LOG_LEVEL,
  serializers: {
    req: serializeRequestForLog,
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-edge-secret"]',
      'req.headers["x-internal-secret"]',
      'req.headers["x-hub-signature-256"]',
      '*.token',
      '*.access_token',
    ],
    censor: logRedactionCensor,
  },
});
