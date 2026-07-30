import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { closePool } from './db/pool.js';
import { MetaWhatsAppAdapter } from './integrations/messaging/meta-whatsapp-adapter.js';
import { MetaInboxProcessor } from './services/meta-inbox-processor.js';
import { FollowupJobProcessor } from './services/followup-job-processor.js';
import { MessagingOutboxDispatcher } from './worker/messaging-outbox-dispatcher.js';
import { OutboxWorker } from './worker/outbox-worker.js';
import { RuntimeWorker } from './worker/runtime-worker.js';

const env = getEnv();
const messagingDispatcher = env.DIRECT_META_SEND_ENABLED
  ? new MessagingOutboxDispatcher({ meta: MetaWhatsAppAdapter.fromEnv() })
  : undefined;
const metaInboxProcessor = env.META_STATUS_PROCESSOR_ENABLED ? new MetaInboxProcessor() : undefined;
const followupJobProcessor = new FollowupJobProcessor();
const runtimeHandlers = messagingDispatcher
  ? {
      dispatchOutbox: (command: Parameters<MessagingOutboxDispatcher['dispatch']>[0]) => messagingDispatcher.dispatch(command),
      ...(metaInboxProcessor ? { processInbox: (event: Parameters<MetaInboxProcessor['process']>[0]) => metaInboxProcessor.process(event) } : {}),
      processJob: (job: Parameters<FollowupJobProcessor['process']>[0]) => followupJobProcessor.process(job),
    }
  : {
      ...(metaInboxProcessor ? { processInbox: (event: Parameters<MetaInboxProcessor['process']>[0]) => metaInboxProcessor.process(event) } : {}),
      processJob: (job: Parameters<FollowupJobProcessor['process']>[0]) => followupJobProcessor.process(job),
    };
const worker = env.WORKER_KIND === 'runtime'
  ? new RuntimeWorker(runtimeHandlers)
  : new OutboxWorker();

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Stopping outbox worker');
  worker.stop();
  await closePool();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

worker.run().catch(async (error) => {
  logger.error({ error }, 'Outbox worker crashed');
  await closePool();
  process.exit(1);
});
