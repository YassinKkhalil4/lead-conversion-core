export const REAL_ESTATE_ROUTING_VERSION = 'real_estate_v1';

export interface RoutingCandidate {
  salespersonId: string;
  name: string;
  phoneE164: string;
  priorityRank: number;
  activeAssignmentCount: number;
  unitMatch: boolean;
  locationMatch: boolean;
  languageMatch: boolean;
}

export interface RankedRoutingCandidate extends RoutingCandidate {
  rank: number;
  score: number;
}

export interface RoutingDecision {
  routingVersion: string;
  outcome: 'assigned' | 'no_eligible_salesperson';
  selected?: RankedRoutingCandidate;
  candidates: RankedRoutingCandidate[];
  reasons: Record<string, unknown>;
}

export function routeRealEstateLead(candidates: RoutingCandidate[]): RoutingDecision {
  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      score:
        (candidate.unitMatch ? 8 : 0) +
        (candidate.locationMatch ? 5 : 0) +
        (candidate.languageMatch ? 3 : 0) -
        candidate.priorityRank -
        candidate.activeAssignmentCount * 10,
      rank: 0,
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

  const selected = ranked[0];
  return {
    routingVersion: REAL_ESTATE_ROUTING_VERSION,
    outcome: selected ? 'assigned' : 'no_eligible_salesperson',
    ...(selected ? { selected } : {}),
    candidates: ranked,
    reasons: selected
      ? {
          selectedSalespersonId: selected.salespersonId,
          selectedRank: selected.rank,
          selectedScore: selected.score,
        }
      : {
          reason: 'no_active_salesperson_for_client_project',
        },
  };
}
