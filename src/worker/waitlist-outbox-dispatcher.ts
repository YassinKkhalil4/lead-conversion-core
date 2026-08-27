import { z } from 'zod';
import { logger } from '../config/logger.js';
import type { ClaimedOutboxCommand } from '../infrastructure/runtime.js';
import { WAITLIST_NOTIFICATION_COMMAND_TYPE } from '../services/waitlist-service.js';
import type { OutboxDispatchResult } from './runtime-worker.js';

const waitlistCommandTypes = [WAITLIST_NOTIFICATION_COMMAND_TYPE] as const;

type WaitlistCommandType = typeof waitlistCommandTypes[number];

const payloadSchema = z.object({
  waitlistSignupId: z.string().uuid(),
  source: z.string().min(1),
  repeat: z.boolean().default(false),
  submissionCount: z.number().int().positive().default(1),
}).passthrough();

export function isWaitlistCommandType(commandType: string): commandType is WaitlistCommandType {
  return (waitlistCommandTypes as readonly string[]).includes(commandType);
}

/**
 * Terminates the outbox command by logging it. There is no email transport in
 * this service and no Meta-approved template for an operator notification, so
 * there is nothing to send yet.
 *
 * The seam is the point: the command is enqueued transactionally with the row,
 * so when a transport is added it attaches here and no caller changes. Marking
 * the command delivered rather than retrying keeps the outbox drained instead
 * of accumulating commands that can never succeed.
 */
export class WaitlistOutboxDispatcher {
  async dispatch(command: ClaimedOutboxCommand): Promise<OutboxDispatchResult> {
    if (!isWaitlistCommandType(command.commandType)) {
      return {
        outcome: 'permanently_failed',
        error: `unsupported_waitlist_outbox_command:${command.commandType}`,
      };
    }

    const parsed = payloadSchema.safeParse(command.payload);
    if (!parsed.success) {
      return {
        outcome: 'permanently_failed',
        error: `invalid_waitlist_payload:${parsed.error.issues[0]?.message || 'unknown'}`,
      };
    }

    // No email address and no free text: the signup id is enough to find the
    // row, and this line goes to the same log stream as everything else.
    logger.info(
      {
        waitlistSignupId: parsed.data.waitlistSignupId,
        source: parsed.data.source,
        repeat: parsed.data.repeat,
        submissionCount: parsed.data.submissionCount,
        outboxCommandId: command.outboxCommandId,
      },
      'Waitlist signup received',
    );

    return { outcome: 'delivered', providerMessageId: command.outboxCommandId };
  }
}

export const waitlistOutboxCommandTypes = [...waitlistCommandTypes];
