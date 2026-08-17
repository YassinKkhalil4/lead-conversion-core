import type { IncomingMessage } from 'node:http';
import pino from 'pino';

const redacted = '**redacted**';

const sensitiveHeaderNames = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-edge-secret',
  'x-internal-secret',
  'x-hub-signature',
  'x-hub-signature-256',
]);

const exactSensitiveQueryNames = new Set([
  'access_token',
  'api_key',
  'client_secret',
  'code',
  'hub.verify_token',
  'password',
  'refresh_token',
  'secret',
  'signature',
  'token',
]);

function isSensitiveQueryName(name: string): boolean {
  const normalized = name.toLowerCase();
  return exactSensitiveQueryNames.has(normalized)
    || normalized.endsWith('_token')
    || normalized.endsWith('.token')
    || normalized.includes('secret');
}

export function redactUrlSecrets(url: string): string {
  try {
    const parsed = new URL(url, 'http://lead-core.local');
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (isSensitiveQueryName(key)) {
        parsed.searchParams.set(key, redacted);
      }
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url.replace(/([?&][^=]*(?:token|secret|signature|password|api_key|code)[^=]*=)[^&]*/gi, `$1${redacted}`);
  }
}

export function redactRequestHeaders(headers: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!headers) return headers;
  return Object.fromEntries(Object.entries(headers).map(([key, value]) => [
    key,
    sensitiveHeaderNames.has(key.toLowerCase()) ? redacted : value,
  ]));
}

export function redactQueryParams(query: Record<string, unknown> | undefined): Record<string, unknown> | undefined;
export function redactQueryParams<T>(query: T): T;
export function redactQueryParams(query: unknown): unknown {
  if (!query) return query;
  if (typeof query !== 'object' || Array.isArray(query)) return query;
  return Object.fromEntries(Object.entries(query).map(([key, value]) => [
    key,
    isSensitiveQueryName(key) ? redacted : value,
  ]));
}

// PostgreSQL error fields that identify *what* failed. `detail`, `hint`,
// `where`, and `internalQuery` are deliberately excluded: they echo the
// offending row values, which are lead PII.
const safePostgresErrorFields = ['code', 'severity', 'constraint', 'table', 'schema', 'column', 'routine'] as const;

const MAX_CAUSE_DEPTH = 3;

export function serializeErrorForLog(value: unknown, depth = 0): Record<string, unknown> {
  if (!(value instanceof Error)) {
    return { type: 'NonError', message: typeof value === 'string' ? value : JSON.stringify(value) ?? String(value) };
  }

  const serialized: Record<string, unknown> = {
    type: value.name,
    message: value.message,
    stack: value.stack,
  };

  const statusCode = (value as { statusCode?: unknown }).statusCode;
  if (statusCode !== undefined) serialized.statusCode = statusCode;

  for (const field of safePostgresErrorFields) {
    const fieldValue = (value as unknown as Record<string, unknown>)[field];
    if (fieldValue !== undefined && fieldValue !== null && fieldValue !== '') {
      serialized[field] = fieldValue;
    }
  }

  if (value.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    serialized.cause = serializeErrorForLog(value.cause, depth + 1);
  }

  return serialized;
}

export function serializeRequestForLog(request: unknown): Record<string, unknown> {
  const serialized = pino.stdSerializers.req(request as IncomingMessage) as unknown as Record<string, unknown>;
  return {
    ...serialized,
    url: typeof serialized.url === 'string' ? redactUrlSecrets(serialized.url) : serialized.url,
    query: redactQueryParams(serialized.query),
    headers: redactRequestHeaders(serialized.headers as Record<string, unknown> | undefined),
  };
}

export { redacted as logRedactionCensor };
