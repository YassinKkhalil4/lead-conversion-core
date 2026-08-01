import type { ClaimedInboxEvent } from '../infrastructure/runtime.js';
import type { InboxProcessingResult } from '../worker/runtime-worker.js';
import { facebookLeadIntakeInput, websiteLeadIntakeInput } from './lead-ingress-payload.js';
import { LeadIntakeService } from './lead-intake-service.js';

export const leadIngressInboxEventTypes = ['lead.created', 'leadgen.created'];
export const leadIngressInboxProviders = ['website', 'facebook'];

function statusCode(error: unknown): number {
  return Number((error as { statusCode?: number }).statusCode || 500);
}

export class LeadIngressInboxProcessor {
  constructor(private readonly intake = new LeadIntakeService()) {}

  async process(event: ClaimedInboxEvent): Promise<InboxProcessingResult> {
    let command;
    try {
      if (event.provider === 'website' && event.eventType === 'lead.created') {
        command = websiteLeadIntakeInput(event.payload);
      } else if (event.provider === 'facebook' && event.eventType === 'leadgen.created') {
        command = facebookLeadIntakeInput(event.payload);
      } else {
        return { outcome: 'ignored', reason: `unsupported_lead_ingress_event:${event.provider}:${event.eventType}` };
      }
    } catch (error) {
      return { outcome: 'ignored', reason: error instanceof Error ? error.message : String(error) };
    }

    try {
      await this.intake.intake(command);
      return { outcome: 'processed' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (statusCode(error) < 500) return { outcome: 'ignored', reason: message };
      return { outcome: 'retryable', error: message };
    }
  }
}
