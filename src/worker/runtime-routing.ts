import type { ClaimedJob, ClaimedOutboxCommand } from '../infrastructure/runtime.js';
import {
  CALENDAR_CREATE_EVENT_COMMAND_TYPE,
  WHATSAPP_SEND_COMMAND_TYPE,
  isNotificationCommandType,
  isWaitlistCommandType,
} from './outbox-command-types.js';
import type { JobProcessingResult, OutboxDispatchResult } from './runtime-worker.js';

export interface OutboxDispatcher {
  dispatch(command: ClaimedOutboxCommand): Promise<OutboxDispatchResult>;
}

/**
 * Messaging and calendar are optional because their providers can be switched
 * off by configuration; notification and waitlist commands only write rows and
 * log, so they always have a dispatcher.
 */
export interface OutboxRoutes {
  messaging?: OutboxDispatcher | undefined;
  calendar?: OutboxDispatcher | undefined;
  notification: OutboxDispatcher;
  waitlist: OutboxDispatcher;
}

function failed(error: string): Promise<OutboxDispatchResult> {
  return Promise.resolve({ outcome: 'permanently_failed', error });
}

/**
 * Picks the dispatcher for a command by its exact type. A type no family
 * claims fails here, with its own name in the error, instead of reaching a
 * provider that was never meant to see it.
 */
export function createOutboxRouter(routes: OutboxRoutes) {
  return (command: ClaimedOutboxCommand): Promise<OutboxDispatchResult> => {
    const type = command.commandType;
    if (type === WHATSAPP_SEND_COMMAND_TYPE) {
      return routes.messaging ? routes.messaging.dispatch(command) : failed('messaging_dispatcher_disabled');
    }
    if (type === CALENDAR_CREATE_EVENT_COMMAND_TYPE) {
      return routes.calendar ? routes.calendar.dispatch(command) : failed('calendar_dispatcher_disabled');
    }
    if (isNotificationCommandType(type)) return routes.notification.dispatch(command);
    if (isWaitlistCommandType(type)) return routes.waitlist.dispatch(command);
    return failed(`unsupported_outbox_command:${type}`);
  };
}

export type JobProcessor = (job: ClaimedJob) => Promise<JobProcessingResult>;

export function createJobRouter(processors: Record<string, JobProcessor>) {
  return (job: ClaimedJob): Promise<JobProcessingResult> => {
    const processor = Object.hasOwn(processors, job.jobType) ? processors[job.jobType] : undefined;
    return processor
      ? processor(job)
      : Promise.resolve({ outcome: 'dead_lettered', reason: `unsupported_scheduled_job:${job.jobType}` });
  };
}
