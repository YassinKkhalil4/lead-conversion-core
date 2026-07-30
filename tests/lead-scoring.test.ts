import { describe, expect, it } from 'vitest';
import { REAL_ESTATE_SCORING_VERSION, scoreRealEstateLead } from '../src/domain/lead-scoring.js';

describe('real_estate_v1 lead scoring', () => {
  it('computes deterministic hot scores from normalized qualification answers', () => {
    const result = scoreRealEstateLead({
      leadStatus: 'qualified',
      currentStage: 'qualified',
      answers: {
        q_location: 'New Cairo',
        q_unit_type: 'Apartment',
        q_budget_min: '3000000',
        q_budget_max: '5000000',
        q_payment_plan: 'Installments',
        q_down_payment: '500000',
        q_timeline: '3 months',
        q_purpose: 'Primary Residence',
        q_site_visit: 'Yes',
      },
    });

    expect(result.scoringVersion).toBe(REAL_ESTATE_SCORING_VERSION);
    expect(result.score).toBe(99);
    expect(result.temperature).toBe('hot');
    expect(result.missingAnswers).toEqual([]);
    expect(result.factors.map((factor) => factor.key)).toEqual([
      'base',
      'budget',
      'timeline',
      'site_visit',
      'payment_plan',
      'down_payment',
      'purpose',
      'unit_type',
      'location_present',
      'qualified_state',
    ]);
  });

  it('keeps input hashes stable across answer object ordering', () => {
    const first = scoreRealEstateLead({
      leadStatus: 'qualified',
      currentStage: 'qualified',
      answers: {
        q_location: 'New Cairo',
        q_site_visit: 'No',
        q_timeline: 'Exploring',
      },
    });
    const second = scoreRealEstateLead({
      leadStatus: 'qualified',
      currentStage: 'qualified',
      answers: {
        q_timeline: 'Exploring',
        q_site_visit: 'No',
        q_location: 'New Cairo',
      },
    });

    expect(first.inputHash).toBe(second.inputHash);
    expect(first.score).toBe(second.score);
    expect(first.temperature).toBe('cold');
    expect(first.missingAnswers).toContain('q_budget_min');
  });
});
