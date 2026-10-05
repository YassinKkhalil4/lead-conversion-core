import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { closePool } from './db/pool.js';
import { GoogleCalendarAdapter } from './integrations/calendar/google-calendar-adapter.js';
import { MetaWhatsAppAdapter } from './integrations/messaging/meta-whatsapp-adapter.js';
import { leadIngressInboxEventTypes } from './services/lead-ingress-inbox-processor.js';
import { MetaInboxProcessor } from './services/meta-inbox-processor.js';
import { FollowupJobProcessor } from './services/followup-job-processor.js';
import { ReservationReminderService } from './services/reservation-reminder-service.js';
import { ReportingService } from './services/reporting-service.js';
import { SlaService } from './services/sla-service.js';
import { CalendarOutboxDispatcher } from './worker/calendar-outbox-dispatcher.js';
import { MessagingOutboxDispatcher } from './worker/messaging-outbox-dispatcher.js';
import { NotificationOutboxDispatcher } from './worker/notification-outbox-dispatcher.js';
import { WaitlistOutboxDispatcher } from './worker/waitlist-outbox-dispatcher.js';
import { createJobRouter, createOutboxRouter } from './worker/runtime-routing.js';
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
const reservationReminders = new ReservationReminderService();
const processRuntimeJob = createJobRouter({
  'sla.notify': (job) => slaService.process(job),
  'followup.send': (job) => followupJobProcessor.process(job),
  'report.daily': (job) => reportingService.process(job),
  'reservation.reminder': (job) => reservationReminders.process(job),
});
const dispatchRuntimeOutbox = createOutboxRouter({
  messaging: messagingDispatcher,
  calendar: calendarDispatcher,
  notification: notificationDispatcher,
  waitlist: waitlistDispatcher,
});
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

// Longer than any single dispatch (provider calls time out at 8-15 s), shorter
// than the worker's 30 s stop_grace_period in docker-compose.yml.
const SHUTDOWN_TIMEOUT_MS = 25_000;
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Stopping runtime worker');
  const forced = setTimeout(() => {
    logger.error({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, 'Runtime worker did not drain in time; exiting');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  forced.unref();
  await worker.stop();
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
