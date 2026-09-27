import { describe, expect, it } from 'vitest';
import type { ManagedUser, Project, Salesperson } from '../dashboard/src/api/types.js';
import { setupProgress } from '../dashboard/src/manage/setup.js';

function project(overrides: Partial<Project> = {}): Project {
  return {
    projectId: 'p1', projectName: 'Palm Heights', active: true, startingPrice: null, maxPrice: null,
    unitTypes: [], location: '', mapsUrl: '', salespersonIds: [], createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function salesperson(overrides: Partial<Salesperson> = {}): Salesperson {
  return {
    salespersonId: 's1', name: 'Mona', phoneE164: '+201001234567', email: '', active: true,
    unitSpecialties: [], locations: [], languages: [], priorityRank: 10, capacityLimit: 20,
    activeAssignmentCount: 0, unacknowledgedAssignmentCount: 0, overdueAssignmentCount: 0,
    acknowledgedCount: 0, avgAcknowledgementSeconds: null, createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

function user(overrides: Partial<ManagedUser> = {}): ManagedUser {
  return {
    userId: 'u1', clientId: 'c1', salespersonId: 's1', email: 'mona@example.test', name: 'Mona',
    role: 'salesperson', active: true, lastLoginAt: null, createdAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}

describe('brokerage setup checklist', () => {
  it('starts with the account step already done', () => {
    const progress = setupProgress({ role: 'admin', projects: [], salespeople: [], users: [] });

    expect(progress?.steps.map((step) => [step.key, step.done])).toEqual([
      ['account', true],
      ['projects', false],
      ['salespeople', false],
      ['coverage', false],
      ['logins', false],
    ]);
    expect(progress?.doneCount).toBe(1);
    expect(progress?.complete).toBe(false);
  });

  it('ignores inactive projects and salespeople without a phone number', () => {
    const progress = setupProgress({
      role: 'admin',
      projects: [project({ active: false, salespersonIds: ['s1'] })],
      salespeople: [salesperson({ phoneE164: '' }), salesperson({ salespersonId: 's2', active: false })],
      users: [user({ active: false })],
    });

    expect(progress?.doneCount).toBe(1);
  });

  it('is complete once a staffed project, a reachable salesperson and a salesperson login exist', () => {
    const progress = setupProgress({
      role: 'admin',
      projects: [project({ salespersonIds: ['s1'] })],
      salespeople: [salesperson()],
      users: [user()],
    });

    expect(progress?.complete).toBe(true);
  });

  it('leaves the login step out for managers, who cannot create accounts', () => {
    const progress = setupProgress({
      role: 'manager',
      projects: [project({ salespersonIds: ['s1'] })],
      salespeople: [salesperson()],
      users: undefined,
    });

    expect(progress?.steps.map((step) => step.key)).not.toContain('logins');
    expect(progress?.complete).toBe(true);
  });

  it('waits for the data it needs before deciding anything', () => {
    expect(setupProgress({ role: 'admin', projects: undefined, salespeople: [], users: [] })).toBeNull();
    expect(setupProgress({ role: 'admin', projects: [], salespeople: [], users: undefined })).toBeNull();
  });
});
