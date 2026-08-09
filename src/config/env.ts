import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((value: 'true' | 'false') => value === 'true');

const baseSchema = z.object({
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
  WORKER_KIND: z.enum(['outbox', 'runtime']).default('outbox'),
  RUNTIME_WORKER_ENABLED: booleanString.default('false'),
  N8N_COMPAT_ROUTES_ENABLED: booleanString.default('false'),
  DIRECT_META_WEBHOOK_ENABLED: booleanString.default('false'),
  DIRECT_LEAD_INGRESS_ENABLED: booleanString.default('false'),
  DIRECT_META_SEND_ENABLED: booleanString.default('false'),
  ACTIVE_TURN_COMPAT_ENABLED: booleanString.default('false'),
  META_WA_ACCESS_TOKEN: z.string().optional().default(''),
  META_WA_PHONE_NUMBER_ID: z.string().optional().default(''),
  META_APPROVED_TEMPLATE_NAMES: z.string().optional().default(''),
  META_APP_SECRET: z.string().optional().default(''),
  META_WEBHOOK_VERIFY_TOKEN: z.string().optional().default(''),
  META_STATUS_PROCESSOR_ENABLED: booleanString.default('false'),
  GRAPH_API_VERSION: z.string().default('v25.0'),
  GOOGLE_CALENDAR_ENABLED: booleanString.default('false'),
  GOOGLE_CALENDAR_ACCESS_TOKEN: z.string().optional().default(''),
  AIRTABLE_BASE_ID: z.string().default('appJxsLRRxegknqY6'),
  AIRTABLE_TOKEN: z.string().optional().default(''),
  AIRTABLE_QUESTIONS_TABLE: z.string().default('Questions'),
  AIRTABLE_OPTIONS_TABLE: z.string().default('Question Options'),
  AIRTABLE_MESSAGES_TABLE: z.string().default('Conversation Messages'),
  SEED_CONFIG_PATH: z.string().default('./config/seed-real-estate.json'),
});

const schema = baseSchema.superRefine((env, ctx) => {
  function requireConfigured(
    condition: boolean,
    field: keyof z.infer<typeof baseSchema>,
    message: string,
    minLength = 1,
  ): void {
    if (!condition) return;
    const value = String(env[field] || '').trim();
    if (value.length >= minLength) return;
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [field],
      message,
    });
  }

  requireConfigured(env.OUTBOX_WORKER_ENABLED, 'OUTBOX_TARGET_URL', 'OUTBOX_TARGET_URL is required when OUTBOX_WORKER_ENABLED=true');
  requireConfigured(env.OUTBOX_WORKER_ENABLED, 'OUTBOX_TARGET_SECRET', 'OUTBOX_TARGET_SECRET must be configured when OUTBOX_WORKER_ENABLED=true', 16);

  requireConfigured(env.DIRECT_META_WEBHOOK_ENABLED, 'META_WEBHOOK_VERIFY_TOKEN', 'META_WEBHOOK_VERIFY_TOKEN is required when DIRECT_META_WEBHOOK_ENABLED=true');
  requireConfigured(env.DIRECT_META_WEBHOOK_ENABLED, 'META_APP_SECRET', 'META_APP_SECRET is required when DIRECT_META_WEBHOOK_ENABLED=true');

  if ((env.DIRECT_META_WEBHOOK_ENABLED || env.DIRECT_LEAD_INGRESS_ENABLED || env.N8N_COMPAT_ROUTES_ENABLED) && !env.RUNTIME_WORKER_ENABLED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['RUNTIME_WORKER_ENABLED'],
      message: 'RUNTIME_WORKER_ENABLED must be true when direct ingress or n8n compatibility routes are enabled',
    });
  }

  if (env.DIRECT_META_WEBHOOK_ENABLED && !env.META_STATUS_PROCESSOR_ENABLED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['META_STATUS_PROCESSOR_ENABLED'],
      message: 'META_STATUS_PROCESSOR_ENABLED must be true when DIRECT_META_WEBHOOK_ENABLED=true',
    });
  }

  requireConfigured(env.DIRECT_META_SEND_ENABLED, 'META_WA_ACCESS_TOKEN', 'META_WA_ACCESS_TOKEN is required when DIRECT_META_SEND_ENABLED=true');
  requireConfigured(env.DIRECT_META_SEND_ENABLED, 'META_WA_PHONE_NUMBER_ID', 'META_WA_PHONE_NUMBER_ID is required when DIRECT_META_SEND_ENABLED=true');

  if (env.ACTIVE_TURN_COMPAT_ENABLED && !env.DIRECT_META_SEND_ENABLED) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['DIRECT_META_SEND_ENABLED'],
      message: 'DIRECT_META_SEND_ENABLED must be true when ACTIVE_TURN_COMPAT_ENABLED=true',
    });
  }

  requireConfigured(env.GOOGLE_CALENDAR_ENABLED, 'GOOGLE_CALENDAR_ACCESS_TOKEN', 'GOOGLE_CALENDAR_ACCESS_TOKEN is required when GOOGLE_CALENDAR_ENABLED=true');
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function parseEnv(input: NodeJS.ProcessEnv): Env {
  return schema.parse(input);
}

export function getEnv(): Env {
  if (!cached) {
    cached = parseEnv(process.env);
  }
  return cached;
}
