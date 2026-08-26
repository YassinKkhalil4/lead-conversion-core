import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { closePool } from './db/pool.js';
import type { ClaimedJob, ClaimedOutboxCommand } from './infrastructure/runtime.js';
import { GoogleCalendarAdapter } from './integrations/calendar/google-calendar-adapter.js';
import { MetaWhatsAppAdapter } from './integrations/messaging/meta-whatsapp-adapter.js';
import { leadIngressInboxEventTypes } from './services/lead-ingress-inbox-processor.js';
import { MetaInboxProcessor } from './services/meta-inbox-processor.js';
import { FollowupJobProcessor } from './services/followup-job-processor.js';
import { ReportingService } from './services/reporting-service.js';
import { SlaService } from './services/sla-service.js';
import { CalendarOutboxDispatcher } from './worker/calendar-outbox-dispatcher.js';
import { MessagingOutboxDispatcher } from './worker/messaging-outbox-dispatcher.js';
import { NotificationOutboxDispatcher, isNotificationCommandType } from './worker/notification-outbox-dispatcher.js';
import { WaitlistOutboxDispatcher, isWaitlistCommandType } from './worker/waitlist-outbox-dispatcher.js';
import { RuntimeWorker } from './worker/runtime-worker.js';
import { buildRuntimeInboxWiring } from './worker/runtime-worker-wiring.js';

const env = getEnv();
const messagingDispatcher = env.DIRECT_META_SEND_ENABLED
  ? new MessagingOutboxDispatcher({ meta: MetaWhatsAppAdapter.fromEnv() })
  : undefined;
const calendarDispatcher = env.GOOGLE_CALENDAR_ENABLED
  ? new CalendarOutboxDispatcher({ calendar: GoogleCalendarAdapter.fromEnv() })
  : undefined;
const notificationDispatcher = new NotificationOutboxDispatcher();
const waitlistDispatcher = new WaitlistOutboxDispatcher();
const {
  metaInboxProcessor,
  leadIngressInboxProcessor,
  inboxEventTypes,
  inboxProviders,
} = buildRuntimeInboxWiring(env);
const followupJobProcessor = new FollowupJobProcessor();
const slaService = new SlaService();
const reportingService = new ReportingService();
const processRuntimeJob = (job: ClaimedJob) => {
  if (job.jobType === 'sla.notify') return slaService.process(job);
  if (job.jobType === 'followup.send') return followupJobProcessor.process(job);
  if (job.jobType === 'report.daily') return reportingService.process(job);
  return Promise.resolve({ outcome: 'dead_lettered' as const, reason: `unsupported_scheduled_job:${job.jobType}` });
};
const dispatchRuntimeOutbox = (command: ClaimedOutboxCommand) => {
  if (command.commandType === 'calendar.create_event') {
    return calendarDispatcher
      ? calendarDispatcher.dispatch(command)
      : Promise.resolve({ outcome: 'permanently_failed' as const, error: 'calendar_dispatcher_disabled' });
  }
  if (isNotificationCommandType(command.commandType)) {
    return notificationDispatcher.dispatch(command);
  }
  if (isWaitlistCommandType(command.commandType)) {
    return waitlistDispatcher.dispatch(command);
  }
  // Anything unrecognised still falls through to messaging. Every new command
  // family needs its own branch above, or it is handed to the WhatsApp sender
  // and fails there instead of where it was written.
  return messagingDispatcher
    ? messagingDispatcher.dispatch(command)
    : Promise.resolve({ outcome: 'permanently_failed' as const, error: 'messaging_dispatcher_disabled' });
};
const runtimeHandlers = {
  dispatchOutbox: dispatchRuntimeOutbox,
  ...(inboxEventTypes.length > 0
    ? {
        processInbox: (event: Parameters<MetaInboxProcessor['process']>[0]) => {
          if (leadIngressInboxProcessor && leadIngressInboxEventTypes.includes(event.eventType)) {
            return leadIngressInboxProcessor.process(event);
          }
          return metaInboxProcessor
            ? metaInboxProcessor.process(event)
            : Promise.resolve({ outcome: 'retryable' as const, error: `inbox_processor_disabled:${event.provider}:${event.eventType}` });
        },
      }
    : {}),
  processJob: processRuntimeJob,
};
const worker = new RuntimeWorker(runtimeHandlers, {
  inboxEventTypes,
  inboxProviders,
  idleSleepMs: env.RUNTIME_WORKER_IDLE_SLEEP_MS,
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Stopping runtime worker');
  worker.stop();
  await closePool();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

worker.run().catch(async (error) => {
  logger.error({ error }, 'Runtime worker crashed');
  await closePool();
  process.exit(1);
});
