import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Errors reach the handler from many places and carry `statusCode` in many
 * shapes. Only a real client or server error status is honoured; anything else
 * (0, NaN, 200, 999, a string) would make `reply.code()` throw inside the
 * error handler itself, so it becomes a plain 500.
 */
export function httpStatusOf(error: unknown): number {
  const status = (error as { statusCode?: unknown } | null | undefined)?.statusCode;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599
    ? status
    : 500;
}

/**
 * Server errors are logged in full and answered with a fixed body; client
 * errors echo their message, which is written for the caller (validation,
 * auth, gating) and never carries driver or stack detail.
 */
export function handleRequestError(error: unknown, request: FastifyRequest, reply: FastifyReply): void {
  const statusCode = httpStatusOf(error);
  const log = statusCode >= 500 ? request.log.error : request.log.warn;
  log.call(request.log, { err: error, statusCode }, 'Request failed');
  reply.code(statusCode).send({
    ok: false,
    error: statusCode >= 500
      ? 'internal_error'
      : error instanceof Error ? error.message : String(error),
  });
}
