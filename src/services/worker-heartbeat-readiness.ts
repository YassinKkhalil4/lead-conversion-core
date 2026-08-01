export type WorkerKind = 'outbox' | 'runtime';

export interface WorkerHeartbeatMetadata {
  [key: string]: unknown;
}

export interface WorkerHeartbeatOperationalState {
  operational: boolean;
  metadata: WorkerHeartbeatMetadata;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === 'true';
}

export function workerHeartbeatOperationalState(
  workerKind: WorkerKind,
  metadata: WorkerHeartbeatMetadata | null | undefined,
): WorkerHeartbeatOperationalState {
  const safeMetadata = metadata || {};
  if (workerKind === 'outbox') {
    return {
      operational: booleanValue(safeMetadata.outboxWorkerEnabled) && booleanValue(safeMetadata.outboxTargetConfigured),
      metadata: safeMetadata,
    };
  }
  const handlerConfigured = booleanValue(safeMetadata.inboxProcessorConfigured)
    || booleanValue(safeMetadata.outboxDispatcherConfigured)
    || booleanValue(safeMetadata.jobProcessorConfigured);
  return {
    operational: booleanValue(safeMetadata.enabled) && handlerConfigured,
    metadata: safeMetadata,
  };
}
