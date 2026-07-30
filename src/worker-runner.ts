import { getEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { closePool } from './db/pool.js';
import { MetaWhatsAppAdapter } from './integrations/messaging/meta-whatsapp-adapter.js';
import { MetaStatusProcessor } from './services/meta-status-webhook-service.js';
import { MessagingOutboxDispatcher } from './worker/messaging-outbox-dispatcher.js';
import { OutboxWorker } from './worker/outbox-worker.js';
import { RuntimeWorker } from './worker/runtime-worker.js';

const env = getEnv();
const messagingDispatcher = env.DIRECT_META_SEND_ENABLED
  ? new MessagingOutboxDispatcher({ meta: MetaWhatsAppAdapter.fromEnv() })
  : undefined;
const statusProcessor = env.META_STATUS_PROCESSOR_ENABLED ? new MetaStatusProcessor() : undefined;
const runtimeHandlers = messagingDispatcher
  ? {
      dispatchOutbox: (command: Parameters<MessagingOutboxDispatcher['dispatch']>[0]) => messagingDispatcher.dispatch(command),
      ...(statusProcessor ? { processInbox: (event: Parameters<MetaStatusProcessor['process']>[0]) => statusProcessor.process(event) } : {}),
    }
  : {
      ...(statusProcessor ? { processInbox: (event: Parameters<MetaStatusProcessor['process']>[0]) => statusProcessor.process(event) } : {}),
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
