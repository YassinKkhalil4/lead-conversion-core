import { describe, expect, it } from 'vitest';
import { REAL_ESTATE_ROUTING_VERSION, type RoutingCandidate, routeRealEstateLead } from '../src/domain/lead-routing.js';

function candidate(overrides: Partial<RoutingCandidate> & { salespersonId: string }): RoutingCandidate {
  return {
    name: `Sales ${overrides.salespersonId}`,
    phoneE164: `+2010000${overrides.salespersonId}`,
    priorityRank: 100,
    activeAssignmentCount: 0,
    capacityLimit: 10,
    unitMatch: false,
    locationMatch: false,
    languageMatch: false,
    ...overrides,
  };
}

describe('real_estate_v2 lead routing capacity', () => {
  it('reports a version distinct from the pre-capacity algorithm', () => {
    // Routing runs are keyed by version and replayed for audit, so a changed
    // decision function must not answer to the old version's name.
    expect(REAL_ESTATE_ROUTING_VERSION).toBe('real_estate_v2');
  });

  it('skips a salesperson at capacity in favour of one below it', () => {
    const decision = routeRealEstateLead([
      candidate({ salespersonId: 'full', priorityRank: 1, activeAssignmentCount: 10, capacityLimit: 10, unitMatch: true }),
      candidate({ salespersonId: 'free', priorityRank: 5, activeAssignmentCount: 2, capacityLimit: 10 }),
    ]);

    expect(decision.outcome).toBe('assigned');
    expect(decision.selected?.salespersonId).toBe('free');
    expect(decision.reasons.excludedOverCapacity).toBe(1);
  });

  it('keeps the over-capacity candidate in the recorded list, flagged', () => {
    const decision = routeRealEstateLead([
      candidate({ salespersonId: 'full', activeAssignmentCount: 10, capacityLimit: 10 }),
      candidate({ salespersonId: 'free', activeAssignmentCount: 0 }),
    ]);

    const recorded = decision.candidates.find((entry) => entry.salespersonId === 'full');
    expect(recorded?.overCapacity).toBe(true);
    expect(decision.candidates).toHaveLength(2);
  });

  it('treats the limit as exclusive: at the limit is full, one below is not', () => {
    const atLimit = routeRealEstateLead([candidate({ salespersonId: 'a', activeAssignmentCount: 3, capacityLimit: 3 })]);
    const belowLimit = routeRealEstateLead([candidate({ salespersonId: 'a', activeAssignmentCount: 2, capacityLimit: 3 })]);

    expect(atLimit.reasons.overCapacityFallback).toBe(true);
    expect(belowLimit.reasons.overCapacityFallback).toBeUndefined();
  });

  it('honours a per-salesperson limit rather than one global number', () => {
    const decision = routeRealEstateLead([
      // Higher absolute load but a bigger allowance, so still eligible.
      candidate({ salespersonId: 'senior', priorityRank: 1, activeAssignmentCount: 12, capacityLimit: 20 }),
      candidate({ salespersonId: 'junior', priorityRank: 2, activeAssignmentCount: 4, capacityLimit: 4 }),
    ]);

    expect(decision.selected?.salespersonId).toBe('senior');
    expect(decision.reasons.excludedOverCapacity).toBe(1);
  });

  it('assigns to the least loaded rather than failing when everyone is full', () => {
    const decision = routeRealEstateLead([
      candidate({ salespersonId: 'busiest', priorityRank: 1, activeAssignmentCount: 30, capacityLimit: 10, unitMatch: true }),
      candidate({ salespersonId: 'least', priorityRank: 9, activeAssignmentCount: 11, capacityLimit: 10 }),
      candidate({ salespersonId: 'middle', priorityRank: 5, activeAssignmentCount: 20, capacityLimit: 10 }),
    ]);

    // A lead nobody owns is worse than a lead owned by the least busy person.
    expect(decision.outcome).toBe('assigned');
    expect(decision.selected?.salespersonId).toBe('least');
    expect(decision.reasons).toMatchObject({
      reason: 'all_salespeople_over_capacity',
      overCapacityFallback: true,
      selectedActiveAssignmentCount: 11,
      selectedCapacityLimit: 10,
      excludedOverCapacity: 3,
    });
  });

  it('still reports no eligible salesperson when there are no candidates at all', () => {
    const decision = routeRealEstateLead([]);
    expect(decision.outcome).toBe('no_eligible_salesperson');
    expect(decision.reasons.reason).toBe('no_active_salesperson_for_client_project');
    expect(decision.selected).toBeUndefined();
  });

  it('is deterministic for the same input', () => {
    const input = [
      candidate({ salespersonId: 'b', priorityRank: 2, unitMatch: true }),
      candidate({ salespersonId: 'a', priorityRank: 2, unitMatch: true }),
    ];
    const first = routeRealEstateLead(input);
    const second = routeRealEstateLead([...input].reverse());
    expect(first.selected?.salespersonId).toBe(second.selected?.salespersonId);
  });

  it('prefers a better match when neither is over capacity', () => {
    const decision = routeRealEstateLead([
      candidate({ salespersonId: 'match', unitMatch: true, locationMatch: true, languageMatch: true }),
      candidate({ salespersonId: 'plain' }),
    ]);
    expect(decision.selected?.salespersonId).toBe('match');
    expect(decision.reasons.excludedOverCapacity).toBeUndefined();
  });
});
