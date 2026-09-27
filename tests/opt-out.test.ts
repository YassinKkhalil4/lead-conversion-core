import { describe, expect, it } from 'vitest';
import { isOptOutMessage } from '../src/domain/opt-out.js';

describe('opt-out detection', () => {
  it.each([
    ['STOP'],
    ['stop please'],
    ['Stop!'],
    ['Please STOP.'],
    ['Stop 🙏'],
    ['unsubscribe'],
    ['الغاء'],
    ['إلغاء'],
    ['وقف'],
    ['بلوك'],
    ['اعمل بلوك'],
    ['مش مهتم'],
    ['انا مش مهتم خلاص'],
    ['مش مهتمة'],
    ['مش عايز'],
    ['مش عايزين'],
  ])('treats %j as an opt-out', (text) => {
    expect(isOptOutMessage(text)).toBe(true);
  });

  it.each([
    ['nonstop'],
    ['stopover in Dubai first'],
    ['unstoppable deal'],
    ['في موقف للعربيات؟'],
    ['عايز شقة في بلوك 3'],
    ['block 5 please'],
    ['مهتم جدا'],
    ['انا مهتم بشقة في التجمع'],
    [''],
    ['   '],
  ])('does not treat %j as an opt-out', (text) => {
    expect(isOptOutMessage(text)).toBe(false);
  });
});
