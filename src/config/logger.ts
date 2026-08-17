import pino from 'pino';
import { getEnv } from './env.js';
import { logRedactionCensor, serializeErrorForLog, serializeRequestForLog } from './log-redaction.js';

export const logger = pino({
  level: getEnv().LOG_LEVEL,
  serializers: {
    req: serializeRequestForLog,
    // `Error.message` and `Error.stack` are non-enumerable, so an Error logged
    // under a key with no serializer renders as `{}`. Both key spellings used
    // in this codebase are covered.
    err: serializeErrorForLog,
    error: serializeErrorForLog,
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
