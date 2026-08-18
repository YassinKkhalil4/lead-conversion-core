/**
 * v2 adds capacity. The decision function is versioned because routing runs are
 * keyed by (lead, version, input hash) and replayed for audit, so a changed
 * algorithm must not answer to the old version's name.
 */
export const REAL_ESTATE_ROUTING_VERSION = 'real_estate_v2';

export interface RoutingCandidate {
  salespersonId: string;
  name: string;
  phoneE164: string;
  priorityRank: number;
  activeAssignmentCount: number;
  /** Active assignments this salesperson may hold before routing skips them. */
  capacityLimit: number;
  unitMatch: boolean;
  locationMatch: boolean;
  languageMatch: boolean;
}

export interface RankedRoutingCandidate extends RoutingCandidate {
  rank: number;
  score: number;
  overCapacity: boolean;
}

export interface RoutingDecision {
  routingVersion: string;
  outcome: 'assigned' | 'no_eligible_salesperson';
  selected?: RankedRoutingCandidate;
  candidates: RankedRoutingCandidate[];
  reasons: Record<string, unknown>;
}

export function routeRealEstateLead(candidates: RoutingCandidate[]): RoutingDecision {
  const ranked: RankedRoutingCandidate[] = candidates
    .map((candidate) => ({
      ...candidate,
      score:
        (candidate.unitMatch ? 8 : 0) +
        (candidate.locationMatch ? 5 : 0) +
        (candidate.languageMatch ? 3 : 0) -
        candidate.priorityRank -
        candidate.activeAssignmentCount * 10,
      rank: 0,
      overCapacity: candidate.activeAssignmentCount >= candidate.capacityLimit,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.priorityRank !== b.priorityRank) return a.priorityRank - b.priorityRank;
      if (a.activeAssignmentCount !== b.activeAssignmentCount) return a.activeAssignmentCount - b.activeAssignmentCount;
      const byName = a.name.localeCompare(b.name);
      if (byName !== 0) return byName;
      return a.salespersonId.localeCompare(b.salespersonId);
    })
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  // Over-capacity candidates stay in the recorded list, flagged, so the run
  // shows who was considered and why they were passed over.
  const withinCapacity = ranked.filter((candidate) => !candidate.overCapacity);
  const overCapacityCount = ranked.length - withinCapacity.length;

  if (withinCapacity.length > 0) {
    const selected = withinCapacity[0]!;
    return {
      routingVersion: REAL_ESTATE_ROUTING_VERSION,
      outcome: 'assigned',
      selected,
      candidates: ranked,
      reasons: {
        selectedSalespersonId: selected.salespersonId,
        selectedRank: selected.rank,
        selectedScore: selected.score,
        ...(overCapacityCount > 0 ? { excludedOverCapacity: overCapacityCount } : {}),
      },
    };
  }

  if (ranked.length > 0) {
    // Everyone is full. A lead nobody owns is worse than a lead owned by the
    // least busy person, so this assigns rather than failing to no_eligible.
    const leastLoaded = [...ranked].sort((a, b) => {
      if (a.activeAssignmentCount !== b.activeAssignmentCount) {
        return a.activeAssignmentCount - b.activeAssignmentCount;
      }
      return a.rank - b.rank;
    })[0]!;

    return {
      routingVersion: REAL_ESTATE_ROUTING_VERSION,
      outcome: 'assigned',
      selected: leastLoaded,
      candidates: ranked,
      reasons: {
        reason: 'all_salespeople_over_capacity',
        overCapacityFallback: true,
        selectedSalespersonId: leastLoaded.salespersonId,
        selectedRank: leastLoaded.rank,
        selectedScore: leastLoaded.score,
        selectedActiveAssignmentCount: leastLoaded.activeAssignmentCount,
        selectedCapacityLimit: leastLoaded.capacityLimit,
        excludedOverCapacity: overCapacityCount,
      },
    };
  }

  return {
    routingVersion: REAL_ESTATE_ROUTING_VERSION,
    outcome: 'no_eligible_salesperson',
    candidates: ranked,
    reasons: { reason: 'no_active_salesperson_for_client_project' },
  };
}
