import { describe, expect, it } from 'vitest';
import { nounCount } from '../dashboard/src/desk/safe.js';
import { updatedLabel } from '../dashboard/src/time/format.js';

describe('nounCount', () => {
  it('uses the singular only for exactly one', () => {
    expect(nounCount(1, 'event')).toBe('1 event');
    expect(nounCount(0, 'event')).toBe('0 events');
    expect(nounCount(2, 'event')).toBe('2 events');
    expect(nounCount(1, 'candidate')).toBe('1 candidate');
  });

  it('accepts an irregular plural', () => {
    expect(nounCount(1, 'person', 'people')).toBe('1 person');
    expect(nounCount(3, 'person', 'people')).toBe('3 people');
  });

  it('shows a dash, not "undefined projects", while the count is unknown', () => {
    expect(nounCount(undefined, 'project')).toBe('— projects');
    expect(nounCount(null, 'project')).toBe('— projects');
  });
});

describe('updatedLabel', () => {
  const now = new Date('2026-10-04T12:00:00Z');

  it('reads as a sentence inside a minute', () => {
    expect(updatedLabel('2026-10-04T11:59:40Z', now)).toBe('updated just now');
  });

  it('says how long ago inside a day', () => {
    expect(updatedLabel('2026-10-04T11:55:00Z', now)).toBe('updated 5m ago');
    expect(updatedLabel('2026-10-04T09:30:00Z', now)).toBe('updated 2h ago');
  });

  it('never tacks "ago" onto an absolute date', () => {
    const label = updatedLabel('2026-10-01T08:00:00Z', now);
    expect(label).toMatch(/^updated \d{1,2} Oct, \d{2}:\d{2}$/);
    expect(label).not.toContain('ago');
  });

  it('never produces "now ago"', () => {
    expect(updatedLabel('2026-10-04T12:00:00Z', now)).not.toContain('now ago');
  });
});
