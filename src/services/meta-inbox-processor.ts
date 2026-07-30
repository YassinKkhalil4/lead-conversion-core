import { EdgeInboundMessageProcessor } from './edge-inbound-message-processor.js';
import { MetaStatusProcessor } from './meta-status-webhook-service.js';
import type { ClaimedInboxEvent } from '../infrastructure/runtime.js';
import type { InboxProcessingResult } from '../worker/runtime-worker.js';

export class MetaInboxProcessor {
  constructor(
    private readonly statuses = new MetaStatusProcessor(),
    private readonly messages = new EdgeInboundMessageProcessor(),
  ) {}

  async process(event: ClaimedInboxEvent): Promise<InboxProcessingResult> {
    if (event.eventType === 'whatsapp.message_status') return this.statuses.process(event);
    if (event.eventType === 'whatsapp.message_received') return this.messages.process(event);
    return { outcome: 'ignored', reason: `unsupported_inbox_event:${event.provider}:${event.eventType}` };
  }
}
