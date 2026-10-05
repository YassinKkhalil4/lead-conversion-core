import { hospitalityHooks } from './hospitality.js';
import { realEstateHooks } from './real-estate.js';
import type { IndustryHooks } from './types.js';

export type { IndustryHooks } from './types.js';

/** Any industry other than hospitality runs the real-estate flow, as before. */
export function industryHooks(industry: string): IndustryHooks {
  return industry === 'hospitality' ? hospitalityHooks : realEstateHooks;
}
