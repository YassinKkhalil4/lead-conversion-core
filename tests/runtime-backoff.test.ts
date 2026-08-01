import { describe, expect, it } from 'vitest';

describe('runtime retry backoff', () => {
  async function retryDelaySeconds(): Promise<typeof import('../src/infrastructure/runtime.js')['retryDelaySeconds']> {
    process.env.DATABASE_URL ||= 'postgresql://127.0.0.1:1/unused';
    process.env.EDGE_SHARED_SECRET ||= 'test_shared_secret_123456';
    process.env.EDGE_INTERNAL_SECRET ||= 'test_internal_secret_123456';
    return (await import('../src/infrastructure/runtime.js')).retryDelaySeconds;
  }

  it('uses bounded exponential backoff with jitter when no provider hint exists', async () => {
    const delay = await retryDelaySeconds();
    const firstAttemptSamples = Array.from({ length: 20 }, () => delay(1));
    const fourthAttemptSamples = Array.from({ length: 20 }, () => delay(4));

    for (const delay of firstAttemptSamples) {
      expect(delay).toBeGreaterThanOrEqual(2);
      expect(delay).toBeLessThanOrEqual(4);
    }
    for (const delay of fourthAttemptSamples) {
      expect(delay).toBeGreaterThanOrEqual(16);
      expect(delay).toBeLessThanOrEqual(32);
    }
    expect(Math.min(...fourthAttemptSamples)).toBeGreaterThan(Math.max(...firstAttemptSamples));
  });

  it('respects provider retry hints with a one-hour cap', async () => {
    const delay = await retryDelaySeconds();
    expect(delay(4, 17)).toBe(17);
    expect(delay(4, 4_000)).toBe(3_600);
  });

  it('bounds extreme attempt counts', async () => {
    const delay = await retryDelaySeconds();
    for (const seconds of Array.from({ length: 20 }, () => delay(100))) {
      expect(seconds).toBeGreaterThanOrEqual(1024);
      expect(seconds).toBeLessThanOrEqual(1054);
    }
  });
});
