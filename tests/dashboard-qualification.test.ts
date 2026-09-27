import { describe, expect, it } from 'vitest';
import type { QualificationAnswer } from '../dashboard/src/api/types.js';
import { currencyFor, formatBudget, indexAnswers, openingLine } from '../dashboard/src/leads/qualification.js';

function answer(questionKey: string, normalizedValue: string): QualificationAnswer {
  return {
    questionKey,
    order: 0,
    answered: true,
    normalizedValue,
    rawValue: normalizedValue,
    parserSource: 'option',
  } as QualificationAnswer;
}

describe('budget currency', () => {
  it('follows the brokerage timezone', () => {
    expect(currencyFor('Asia/Dubai')).toBe('AED');
    expect(currencyFor('Africa/Cairo')).toBe('EGP');
    expect(currencyFor('Europe/London')).toBe('');
  });

  it('labels a budget with the brokerage currency, or with none', () => {
    expect(formatBudget('4000000', 'AED')).toBe('4M AED');
    expect(formatBudget('3000000-5000000', 'EGP')).toBe('3M – 5M EGP');
    expect(formatBudget('0-2000000', '')).toBe('Under 2M');
  });
});

describe('opening line', () => {
  it('uses the right article and no dash in the greeting', () => {
    const answers = indexAnswers([answer('q_unit_type', 'Apartment'), answer('q_location', 'Dubai Marina')]);

    const line = openingLine('Rashid Al Mansoori', answers, 'English');

    expect(line).toBe('Hi Rashid, following up on your interest in an apartment in Dubai Marina. I have a few options that fit.');
  });

  it('keeps "a" before a consonant', () => {
    const answers = indexAnswers([answer('q_unit_type', 'Villa')]);

    expect(openingLine('Sara Khoury', answers, 'English')).toContain('interest in a villa.');
  });
});
