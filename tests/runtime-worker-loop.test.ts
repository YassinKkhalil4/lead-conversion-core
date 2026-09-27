import { beforeAll, describe, expect, it } from 'vitest';
import type { ClaimedJob } from '../src/infrastructure/runtime.js';
import type { JobProcessingResult } from '../src/worker/runtime-worker.js';

type RuntimeWorkerModule = typeof import('../src/worker/runtime-worker.js');

let RuntimeWorker: RuntimeWorkerModule['RuntimeWorker'];

beforeAll(async () => {
  process.env.DATABASE_URL ||= 'postgresql://127.0.0.1:1/unused';
  process.env.EDGE_SHARED_SECRET ||= 'test_shared_secret_123456';
  process.env.EDGE_INTERNAL_SECRET ||= 'test_internal_secret_123456';
  ({ RuntimeWorker } = await import('../src/worker/runtime-worker.js'));
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function job(id: string): ClaimedJob {
  return { scheduledJobId: id, workerId: 'loop-test', jobType: 'report.daily', attemptCount: 1, payload: {} };
}

/** Scripted claims: each call to claim() takes the next step, then returns nothing. */
class ScriptedJobs {
  readonly steps: Array<() => Promise<ClaimedJob[]>> = [];
  readonly completed: string[] = [];

  async claim(): Promise<ClaimedJob[]> {
    const next = this.steps.shift();
    return next ? next() : [];
  }

  async complete(id: string): Promise<boolean> {
    this.completed.push(id);
    return true;
  }

  async retry(): Promise<boolean> {
    return true;
  }

  async deadLetter(): Promise<boolean> {
    return true;
  }
}

class ScriptedHeartbeats {
  readonly failures: Error[] = [];
  beats = 0;

  async beat(): Promise<void> {
    this.beats += 1;
    const failure = this.failures.shift();
    if (failure) throw failure;
  }
}

function buildWorker(input: {
  jobs: ScriptedJobs;
  processJob: (job: ClaimedJob) => Promise<JobProcessingResult>;
  heartbeats?: ScriptedHeartbeats;
  idleSleepMs?: number;
}) {
  return new RuntimeWorker(
    { processJob: input.processJob },
    { enabled: true, idleSleepMs: input.idleSleepMs ?? 5, errorBackoffMs: 5, heartbeatIntervalMs: 0 },
    {} as never,
    {} as never,
    input.jobs as never,
    (input.heartbeats ?? new ScriptedHeartbeats()) as never,
  );
}

describe('runtime worker loop', () => {
  it('keeps running after a batch claim fails', async () => {
    const jobs = new ScriptedJobs();
    jobs.steps.push(async () => {
      throw new Error('connection reset by peer');
    });
    jobs.steps.push(async () => [job('job-after-failure')]);
    const processed = deferred<void>();
    const worker = buildWorker({
      jobs,
      processJob: async () => {
        processed.resolve();
        return { outcome: 'completed' };
      },
    });

    const running = worker.run();
    await processed.promise;
    await worker.stop();

    await expect(running).resolves.toBeUndefined();
    expect(jobs.completed).toEqual(['job-after-failure']);
  });

  it('keeps running after a heartbeat write fails', async () => {
    const jobs = new ScriptedJobs();
    jobs.steps.push(async () => [job('job-after-heartbeat-failure')]);
    const heartbeats = new ScriptedHeartbeats();
    heartbeats.failures.push(new Error('database is starting up'));
    const processed = deferred<void>();
    const worker = buildWorker({
      jobs,
      heartbeats,
      processJob: async () => {
        processed.resolve();
        return { outcome: 'completed' };
      },
    });

    const running = worker.run();
    await processed.promise;
    await worker.stop();

    await expect(running).resolves.toBeUndefined();
    expect(heartbeats.beats).toBeGreaterThanOrEqual(2);
    expect(jobs.completed).toEqual(['job-after-heartbeat-failure']);
  });

  it('lets the in-flight batch record its outcome before stop resolves', async () => {
    const jobs = new ScriptedJobs();
    jobs.steps.push(async () => [job('job-in-flight')]);
    const started = deferred<void>();
    const release = deferred<void>();
    const worker = buildWorker({
      jobs,
      processJob: async () => {
        started.resolve();
        await release.promise;
        return { outcome: 'completed' };
      },
    });

    const running = worker.run();
    await started.promise;
    let stopped = false;
    const stopping = worker.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(stopped).toBe(false);

    release.resolve();
    await stopping;
    await running;
    expect(jobs.completed).toEqual(['job-in-flight']);
  });

  it('wakes from an idle sleep as soon as it is stopped', async () => {
    const jobs = new ScriptedJobs();
    const worker = buildWorker({
      jobs,
      idleSleepMs: 60_000,
      processJob: async () => ({ outcome: 'completed' }),
    });

    const running = worker.run();
    await new Promise((resolve) => setTimeout(resolve, 25));
    const startedStopping = Date.now();
    await worker.stop();
    await running;

    expect(Date.now() - startedStopping).toBeLessThan(500);
  });
});
