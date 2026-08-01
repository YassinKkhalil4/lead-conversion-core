import type { Env } from '../config/env.js';
import {
  LeadIngressInboxProcessor,
  leadIngressInboxEventTypes,
  leadIngressInboxProviders,
} from '../services/lead-ingress-inbox-processor.js';
import {
  MetaInboxProcessor,
  metaInboxEventTypes,
  metaInboxProviders,
} from '../services/meta-inbox-processor.js';

type RuntimeWiringEnv = Pick<
  Env,
  'META_STATUS_PROCESSOR_ENABLED' | 'N8N_COMPAT_ROUTES_ENABLED' | 'DIRECT_LEAD_INGRESS_ENABLED'
>;

export interface RuntimeInboxWiring {
  metaInboxProcessor?: MetaInboxProcessor;
  leadIngressInboxProcessor?: LeadIngressInboxProcessor;
  inboxEventTypes: string[];
  inboxProviders: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildRuntimeInboxWiring(env: RuntimeWiringEnv): RuntimeInboxWiring {
  const metaInboxProcessor = env.META_STATUS_PROCESSOR_ENABLED || env.N8N_COMPAT_ROUTES_ENABLED
    ? new MetaInboxProcessor()
    : undefined;
  const leadIngressInboxProcessor = env.DIRECT_LEAD_INGRESS_ENABLED
    ? new LeadIngressInboxProcessor()
    : undefined;

  return {
    ...(metaInboxProcessor ? { metaInboxProcessor } : {}),
    ...(leadIngressInboxProcessor ? { leadIngressInboxProcessor } : {}),
    inboxEventTypes: unique([
      ...(metaInboxProcessor ? metaInboxEventTypes : []),
      ...(leadIngressInboxProcessor ? leadIngressInboxEventTypes : []),
    ]),
    inboxProviders: unique([
      ...(metaInboxProcessor ? metaInboxProviders : []),
      ...(leadIngressInboxProcessor ? leadIngressInboxProviders : []),
    ]),
  };
}
