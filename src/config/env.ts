import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((value: 'true' | 'false') => value === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  EDGE_HOST: z.string().default('0.0.0.0'),
  EDGE_PORT: z.coerce.number().int().positive().default(8080),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  EDGE_SHARED_SECRET: z.string().min(16),
  EDGE_INTERNAL_SECRET: z.string().min(16),
  EDGE_MODE: z.enum(['shadow', 'active']).default('shadow'),
  SHADOW_STATE_AUTHORITY: z.enum(['legacy', 'edge']).default('legacy'),
  DEFAULT_CONVERSATION_ENGINE: z.enum(['legacy', 'edge']).default('legacy'),
  OUTBOX_WORKER_ENABLED: booleanString.default('false'),
  OUTBOX_TARGET_URL: z.string().url().optional().or(z.literal('')),
  OUTBOX_TARGET_SECRET: z.string().optional().default(''),
  WORKER_NAME: z.string().optional().default(''),
  WORKER_KIND: z.string().optional().default('outbox'),
  RUNTIME_WORKER_ENABLED: booleanString.default('false'),
  DIRECT_META_SEND_ENABLED: booleanString.default('false'),
  META_WA_ACCESS_TOKEN: z.string().optional().default(''),
  META_WA_PHONE_NUMBER_ID: z.string().optional().default(''),
  META_APPROVED_TEMPLATE_NAMES: z.string().optional().default(''),
  META_APP_SECRET: z.string().optional().default(''),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional().default(''),
  META_STATUS_PROCESSOR_ENABLED: booleanString.default('false'),
  GRAPH_API_VERSION: z.string().default('v25.0'),
  AIRTABLE_BASE_ID: z.string().default('appJxsLRRxegknqY6'),
  AIRTABLE_TOKEN: z.string().optional().default(''),
  AIRTABLE_QUESTIONS_TABLE: z.string().default('Questions'),
  AIRTABLE_OPTIONS_TABLE: z.string().default('Question Options'),
  AIRTABLE_MESSAGES_TABLE: z.string().default('Conversation Messages'),
  SEED_CONFIG_PATH: z.string().default('./config/seed-real-estate.json'),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function getEnv(): Env {
  if (!cached) {
    cached = schema.parse(process.env);
  }
  return cached;
}
