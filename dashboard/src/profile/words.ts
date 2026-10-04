import type { Terms } from './types';

const KEYS: Record<string, keyof Terms> = {
  lead: 'lead',
  leads: 'leads',
  person: 'person',
  people: 'people',
  place: 'place',
  places: 'places',
  booked: 'booked',
  visit: 'visit',
  category: 'category',
  categories: 'categories',
};

/**
 * Fills the vertical's nouns into a sentence. `{leads}` becomes "leads" or
 * "guests"; `{Leads}` keeps the term's own capital letter. A token that is not
 * a known noun is left as written, so a stray brace never blanks a message.
 *
 * Real estate maps each noun to itself, so a sentence written with tokens reads
 * exactly as the plain sentence did.
 */
export function words(template: string, terms: Terms): string {
  return template.replace(/\{([A-Za-z]+)\}/g, (match, token: string) => {
    const key = KEYS[token.toLowerCase()];
    if (!key) return match;
    const term = terms[key];
    return token[0] === token[0]!.toUpperCase() ? term : term.toLowerCase();
  });
}
