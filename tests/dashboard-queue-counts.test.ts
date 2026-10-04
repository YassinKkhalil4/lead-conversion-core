import { describe, expect, it } from 'vitest';
import type { Lead } from '../dashboard/src/api/types.js';
import { countToday } from '../dashboard/src/leads/queue.js';

const NOW = new Date('2026-10-04T12:00:00');

function lead(id: string, overrides: Record<string, unknown> = {}): Lead {
  return {
    leadId: id,
    createdAt: '2026-10-04T08:00:00',
    lastOutboundAt: null,
    assignment: null,
    ...overrides,
  } as unknown as Lead;
}

describe('countToday', () => {
  it('counts a lead once even when two loaded lists both contain it', () => {
    // The queue merges "unacknowledged" with "recent", and a lead can be in both.
    const unacknowledged = [lead('a'), lead('b')];
    const recent = [lead('a'), lead('b'), lead('c')];
    expect(countToday([...unacknowledged, ...recent], NOW).received).toBe(3);
  });

  it('counts acknowledgements and replies once per lead as well', () => {
    const acked = lead('a', {
      assignment: { acknowledgedAt: '2026-10-04T09:00:00' },
      lastOutboundAt: '2026-10-04T09:05:00',
    });
    const counts = countToday([acked, acked, lead('b')], NOW);
    expect(counts).toEqual({ received: 2, acknowledged: 1, replied: 1 });
  });

  it('ignores leads from before today', () => {
    const old = lead('old', { createdAt: '2026-10-02T08:00:00' });
    expect(countToday([old, lead('new')], NOW).received).toBe(1);
  });
});
