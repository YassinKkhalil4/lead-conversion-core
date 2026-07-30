import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

export const metricsRegistry = new Registry();
collectDefaultMetrics({ register: metricsRegistry });

export const evaluationDurationMs = new Histogram({
  name: 'conversation_edge_evaluation_duration_ms',
  help: 'Shadow evaluation duration in milliseconds',
  buckets: [5, 10, 20, 50, 100, 250, 500, 1000],
  labelNames: ['result'] as const,
  registers: [metricsRegistry],
});

export const evaluationsTotal = new Counter({
  name: 'conversation_edge_evaluations_total',
  help: 'Number of shadow evaluations',
  labelNames: ['result', 'stage'] as const,
  registers: [metricsRegistry],
});

export const duplicateMessagesTotal = new Counter({
  name: 'conversation_edge_duplicate_messages_total',
  help: 'Duplicate inbound events suppressed by idempotency',
  registers: [metricsRegistry],
});

export const outboxPendingGauge = new Gauge({
  name: 'conversation_edge_outbox_pending',
  help: 'Pending outbox rows',
  registers: [metricsRegistry],
});
